import { computeQuote } from './pricing.js';
const state = { seatCount: 10, yearlyBilling: false };
function renderTotal() {
  document.getElementById('seats').textContent = String(state.seatCount);
  const amount = computeQuote(29, state.seatCount, state.yearlyBilling);
  document.getElementById('total').textContent = 'Total: $' + amount.toFixed(2) + (state.yearlyBilling ? '/yr' : '/mo');
}
document.getElementById('more').addEventListener('click', () => { state.seatCount += 1; renderTotal(); });
document.getElementById('yearly').addEventListener('click', () => { state.yearlyBilling = !state.yearlyBilling; renderTotal(); });
document.getElementById('contact').addEventListener('submit', (event) => {
  event.preventDefault();
  const email = document.getElementById('email').value;
  document.getElementById('status').textContent = /@/.test(email) ? 'Thanks, we will reply soon.' : 'Please enter a valid email address.';
});
renderTotal();
