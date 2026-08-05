// ─────────────────────────────────────────────────────────────
// 토스페이먼츠 결제 최종 승인 (서버 사이드 · Vercel Serverless Function)
//   · 프론트 결제창에서 결제 후, successUrl(/course-success)이 이 엔드포인트를 호출.
//   · 시크릿키는 절대 프론트에 노출하지 않고 여기(서버)에서만 사용.
//   · 설정: Vercel 프로젝트 → Settings → Environment Variables 에
//           TOSS_SECRET_KEY            = 토스 시크릿키 (테스트: test_sk_..., 실서비스: live_sk_...)
//           SUPABASE_URL               = https://xxxx.supabase.co
//           SUPABASE_SERVICE_ROLE_KEY  = Supabase → Settings → API → service_role
//
//   처리 순서: ① 상품 정가 대조 → ② 중복 승인 차단 → ③ 토스 승인 → ④ 주문 저장
// ─────────────────────────────────────────────────────────────

// 판매 상품 정가 — 이 값이 결제 금액의 유일한 기준입니다.
// 프론트(api/pay-config.js)와 반드시 동일하게 유지할 것.
const PRODUCTS = {
  'visit-care': { amount: 330000, orderName: '비주얼 클리닉 방문 케어' },
  'course-14d': { amount:  99000, orderName: '팔자주름 14일 홈케어' }
};

// orderId 형식: vc_<상품id>_<시각>_<난수>  (예: vc_visit-care_1754300000000_a1b2c3)
function productIdOf(orderId) {
  const m = /^vc_([a-z0-9-]+)_\d+_/.exec(String(orderId || ''));
  return m ? m[1] : null;
}

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sbReady = () => Boolean(SB_URL && SB_KEY);
function sbHeaders(extra) {
  return Object.assign({
    apikey: SB_KEY,
    Authorization: 'Bearer ' + SB_KEY,
    'Content-Type': 'application/json'
  }, extra || {});
}

// 이미 승인 완료된 주문인지 확인 (완료 페이지 새로고침 대비)
async function findPaidOrder(orderId) {
  if (!sbReady()) return null;
  const url = SB_URL + '/rest/v1/orders?order_id=eq.' + encodeURIComponent(orderId) +
              '&status=eq.paid&select=order_id,order_name,amount,method,approved_at&limit=1';
  const r = await fetch(url, { headers: sbHeaders() });
  if (!r.ok) return null;
  const rows = await r.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, message: 'Method Not Allowed' });
    return;
  }

  const secretKey = process.env.TOSS_SECRET_KEY;
  if (!secretKey) {
    res.status(503).json({
      ok: false,
      message: 'TOSS_SECRET_KEY 미설정 — Vercel 환경변수에 토스 시크릿키를 추가하면 결제 승인이 활성화됩니다.'
    });
    return;
  }

  // Vercel Node 런타임은 JSON 본문을 자동 파싱하지만, 문자열로 오는 경우도 안전 처리
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const { paymentKey, orderId, amount } = body || {};

  if (!paymentKey || !orderId || !amount) {
    res.status(400).json({ ok: false, message: 'paymentKey · orderId · amount 가 필요합니다.' });
    return;
  }

  // ── ① 상품 정가 대조 (승인 요청 전) ──────────────────────────
  // 클라이언트가 보낸 금액을 그대로 승인하면 콘솔에서 금액을 조작해
  // 33만원 상품을 1,000원에 결제할 수 있습니다. 서버 정가만 신뢰합니다.
  const productId = productIdOf(orderId);
  const product = productId ? PRODUCTS[productId] : null;
  if (!product || Number(amount) !== product.amount) {
    res.status(400).json({ ok: false, message: '주문 정보가 올바르지 않습니다. 다시 시도해 주세요.' });
    return;
  }

  // ── ② 중복 승인 차단 (완료 페이지 새로고침 대비) ─────────────
  try {
    const already = await findPaidOrder(orderId);
    if (already) {
      res.status(200).json({
        ok: true,
        orderId: already.order_id,
        orderName: already.order_name,
        amount: already.amount,
        method: already.method,
        approvedAt: already.approved_at,
        productId: productId
      });
      return;
    }
  } catch (e) {
    // 조회 실패는 치명적이지 않음 — 승인 단계로 진행 (토스가 중복 승인을 거부해 줌)
    console.error('[confirm-payment] 기존 주문 조회 실패:', e);
  }

  // ── ③ 토스 승인 ─────────────────────────────────────────────
  let data;
  try {
    const auth = 'Basic ' + Buffer.from(secretKey + ':').toString('base64');
    const tossRes = await fetch('https://api.tosspayments.com/v1/payments/confirm', {
      method: 'POST',
      headers: {
        'Authorization': auth,
        'Content-Type': 'application/json',
        'Idempotency-Key': String(orderId)
      },
      body: JSON.stringify({ paymentKey, orderId, amount: product.amount })
    });
    data = await tossRes.json();

    if (!tossRes.ok) {
      res.status(tossRes.status).json({ ok: false, code: data.code, message: data.message || '결제 승인에 실패했습니다.' });
      return;
    }
  } catch (err) {
    res.status(500).json({ ok: false, message: '서버 오류: ' + String(err) });
    return;
  }

  // ── ④ 주문 저장 ─────────────────────────────────────────────
  // 여기서 실패해도 결제는 이미 완결되었으므로 사용자에게는 성공을 알립니다.
  // 저장 실패는 Vercel 로그로 추적해 수동 보정합니다.
  if (sbReady()) {
    try {
      const save = await fetch(SB_URL + '/rest/v1/orders', {
        method: 'POST',
        headers: sbHeaders({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify({
          order_id: data.orderId,
          payment_key: data.paymentKey || paymentKey,
          product_id: productId,
          order_name: data.orderName || product.orderName,
          amount: data.totalAmount,
          currency: data.currency || 'KRW',
          status: 'paid',
          method: data.method,
          customer_email: data.customerEmail || null,
          raw: data,
          approved_at: data.approvedAt
        })
      });
      if (!save.ok) {
        console.error('[confirm-payment] 주문 저장 실패', save.status, await save.text());
      }
    } catch (e) {
      console.error('[confirm-payment] 주문 저장 예외:', e);
    }
  } else {
    console.error('[confirm-payment] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 미설정 — 주문이 저장되지 않았습니다.');
  }

  res.status(200).json({
    ok: true,
    orderId: data.orderId,
    orderName: data.orderName,
    amount: data.totalAmount,
    method: data.method,
    approvedAt: data.approvedAt,
    productId: productId
  });
};
