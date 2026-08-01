// ─────────────────────────────────────────────────────────────
// 토스페이먼츠 결제 최종 승인 (서버 사이드 · Vercel Serverless Function)
//   · 프론트 결제창에서 결제 후, successUrl(/course-success)이 이 엔드포인트를 호출.
//   · 시크릿키는 절대 프론트에 노출하지 않고 여기(서버)에서만 사용.
//   · 설정: Vercel 프로젝트 → Settings → Environment Variables 에
//           TOSS_SECRET_KEY = (토스 대시보드의 시크릿키, 테스트: test_sk_..., 실서비스: live_sk_...)
//   · TODO(결제 오픈 후): 승인 성공 시 주문/수강권한을 DB에 저장하고 영상 접근권을 부여.
// ─────────────────────────────────────────────────────────────
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

  try {
    const auth = 'Basic ' + Buffer.from(secretKey + ':').toString('base64');
    const tossRes = await fetch('https://api.tosspayments.com/v1/payments/confirm', {
      method: 'POST',
      headers: { 'Authorization': auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentKey, orderId, amount: Number(amount) })
    });
    const data = await tossRes.json();

    if (!tossRes.ok) {
      res.status(tossRes.status).json({ ok: false, code: data.code, message: data.message || '결제 승인에 실패했습니다.' });
      return;
    }

    // ── 결제 승인 성공 ──
    // TODO(결제 오픈 후): 여기서 주문/수강권한 저장(DB) + 영상 접근권 부여.
    res.status(200).json({
      ok: true,
      orderId: data.orderId,
      orderName: data.orderName,
      amount: data.totalAmount,
      method: data.method,
      approvedAt: data.approvedAt
    });
  } catch (err) {
    res.status(500).json({ ok: false, message: '서버 오류: ' + String(err) });
  }
};
