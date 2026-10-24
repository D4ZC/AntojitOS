const REASON_PRESETS = {
  item: ["Error", "Sin razón", "Pedido duplicado", "Cliente canceló", "Cambio de pedido"],
  account: ["Error", "Sin razón", "Pedido duplicado", "Cliente canceló", "Cambio de pedido"],
  table: ["Error", "Sin razón", "Mesa abierta por error", "Cliente canceló", "Cambio de mesa"],
  management: ["Error", "Sin razón", "Cliente frecuente", "Cambio de pedido", "Cambio de mesa", "Pedido duplicado", "Cliente canceló"],
  receiptCancellation: ["Error", "Sin razón", "Ticket duplicado", "Cliente canceló", "Cambio de pedido"],
  refund: ["Error", "Sin razón", "Cliente canceló", "Producto incorrecto", "Cobro incorrecto"],
  paymentVoid: ["Error", "Sin razón", "Pago duplicado", "Importe incorrecto", "Método de pago incorrecto"],
  billVoid: ["Error", "Sin razón", "Cargo duplicado", "Importe incorrecto", "Proveedor incorrecto"],
  reprint: ["Error", "Sin razón", "No se imprimió", "Falta de papel", "Copia para el cliente", "Ticket ilegible"],
  cashIn: ["Cambio para caja", "Reposición de efectivo", "Error", "Sin razón"],
  cashOut: ["Compra de insumos", "Pago a proveedor", "Retiro de efectivo", "Error", "Sin razón"],
} as const;

interface ReasonPresetsProps {
  context: keyof typeof REASON_PRESETS;
  value: string;
  onChange(value: string): void;
  disabled?: boolean;
  autoFocus?: boolean;
}

export const ReasonPresets = ({ context, value, onChange, disabled = false, autoFocus = false }: ReasonPresetsProps) => (
  <div className="reason-presets" role="group" aria-label="Motivos rápidos">
    {REASON_PRESETS[context].map((reason, index) => (
      <button
        key={reason}
        type="button"
        className={value.trim() === reason ? "selected" : ""}
        aria-pressed={value.trim() === reason}
        disabled={disabled}
        autoFocus={autoFocus && index === 0}
        onClick={() => onChange(reason)}
      >{reason}</button>
    ))}
  </div>
);
