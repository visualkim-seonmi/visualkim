// ─────────────────────────────────────────────────────────────
// 결제 설정 배포 (서버 사이드 · Vercel Serverless Function)
//   · 프론트가 결제창을 열기 직전 이 엔드포인트에서 클라이언트키를 받아옵니다.
//   · 클라이언트키는 공개용이라 노출되어도 안전합니다. (시크릿키는 절대 여기 넣지 마세요)
//   · 이렇게 두면 테스트키 → 실서비스키 전환이 Vercel 환경변수 수정만으로 끝납니다.
//   · 설정: Vercel → Settings → Environment Variables
//           TOSS_CLIENT_KEY   = 토스 대시보드의 클라이언트키 (test_ck_... / live_ck_...)
//           TOSS_SDK_VERSION  = (선택) 'v2' 기본. 계정이 v1 키만 발급하면 'v1'
// ─────────────────────────────────────────────────────────────

// 판매 상품 정가 — api/confirm-payment.js 의 PRODUCTS 와 반드시 동일하게 유지할 것.
// (프론트는 표시용으로만 사용하고, 실제 금액 검증은 confirm-payment.js 가 수행)
const PRODUCTS = {
  'visit-care': { amount: 330000, orderName: '비주얼 클리닉 방문 케어' },
  'course-14d': { amount:  99000, orderName: '팔자주름 14일 홈케어' }
};

module.exports = (req, res) => {
  // 클라이언트키는 자주 바뀌지 않으므로 짧게 캐시 (키 교체 시 최대 1분 지연)
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.status(200).json({
    clientKey: process.env.TOSS_CLIENT_KEY || '',
    sdk: process.env.TOSS_SDK_VERSION === 'v1' ? 'v1' : 'v2',
    products: PRODUCTS
  });
};
