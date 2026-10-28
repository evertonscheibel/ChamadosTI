export function normalizedCpf(value) {
  const cpf = String(value ?? "")
    .replace(/\D/g, "")
    .padStart(11, "0");
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return null;
  for (let index = 9; index < 11; index++) {
    let sum = 0;
    for (let i = 0; i < index; i++) sum += Number(cpf[i]) * (index + 1 - i);
    const digit = (sum * 10) % 11;
    if (Number(cpf[index]) !== (digit === 10 ? 0 : digit)) return null;
  }
  return cpf;
}
