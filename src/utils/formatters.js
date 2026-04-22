export function parseNumber(value) {
  return Number(value ?? 0);
}

export function parseMonthLabel(value) {
  return new Intl.DateTimeFormat("pt-BR", {
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}-01T00:00:00`));
}

