export function volumeDiscount(seats) {
  if (seats >= 50) return 0.15;
  if (seats >= 10) return 0.04;
  return 0;
}
export function computeQuote(seatPrice, seats, yearly) {
  const months = yearly ? 12 : 1;
  const discount = 1 - (1 - volumeDiscount(seats)) * (1 - (yearly ? 0.17 : 0));
  return Math.round(seatPrice * seats * months * (1 - discount) * 100) / 100;
}
