export interface NumericField {
  label: string;
  min?: number;
  max?: number;
  step?: number;
}

export function validateNumber(value: string, field: NumericField): string {
  if (!value.trim()) return `请输入${field.label}`;
  const number = Number(value);
  if (!Number.isFinite(number)) return `${field.label}须为有效数字`;
  if (field.min !== undefined && number < field.min || field.max !== undefined && number > field.max) {
    return `请输入 ${field.min ?? "不限"} 至 ${field.max ?? "不限"} 之间的数值`;
  }
  if (field.step && Math.abs((number - (field.min ?? 0)) / field.step - Math.round((number - (field.min ?? 0)) / field.step)) > 1e-7) {
    return field.step === 1 ? "请输入整数" : `请以 ${field.step} 为步长调整`;
  }
  return "";
}
