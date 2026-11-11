export const SESSION_USER_KEY = "ver_estoque_intranet_user";
export const SESSION_PASS_KEY = "ver_estoque_intranet_pass";

export const criarLinhaPedidoVazia = () => ({
  id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
  pedido: "",
  data_entrega: "",
});

export const formatarQtd = (val) => {
  if (val === null || val === undefined || val === "") return "-";
  const num = Number(val);
  if (isNaN(num)) return String(val);
  return num.toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
};

export const formatarPerc = (val) => {
  if (val === null || val === undefined || val === "") return "0%";
  const num = Number(val);
  if (isNaN(num)) return "0%";
  return `${num.toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  })}%`;
};

export const truncar = (str, maxLen) => {
  const s = String(str ?? "-").trim() || "-";
  return s.length > maxLen ? s.slice(0, maxLen - 1) + "…" : s;
};
