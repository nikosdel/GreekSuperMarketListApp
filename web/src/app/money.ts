export function euro(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—';
  }
  return new Intl.NumberFormat('el-GR', { style: 'currency', currency: 'EUR' }).format(value);
}

export function amount(value: string | number): string {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return '';
  }
  return new Intl.NumberFormat('el-GR', { maximumFractionDigits: 3 }).format(number);
}

export function when(value: string | null): string {
  if (!value) {
    return '';
  }
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Bucharest',
  }).format(new Date(value));
}
