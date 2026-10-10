export const sports = [
  "Badminton",
  "Tennis",
  "Pickleball",
  "Table Tennis",
  "Squash",
  "Cricket",
  "Football",
  "Basketball",
  "Volleyball",
  "Hockey",
  "Kabaddi",
  "Kho Kho",
  "Handball",
  "Rugby",
  "Futsal",
  "Chess",
  "Carrom",
  "Athletics",
  "Swimming",
  "Boxing",
  "Wrestling",
  "Archery",
  "Esports",
];
export function normalizeSport(value: string) {
  const name = value.trim().replace(/\s+/g, " ");
  return (
    sports.find((s) => s.toLowerCase() === name.toLowerCase()) ||
    name.toLowerCase().replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase())
  );
}
