import React, { useEffect } from "react";
import Icon from "./Icon";

/**
 * Toast não-bloqueante no canto inferior direito para notificações de erro, sucesso ou info.
 */
export default function Toast({ toast, onClose, duration = 5000 }) {
  useEffect(() => {
    if (!toast || !duration) return;
    const timer = setTimeout(() => {
      onClose?.();
    }, duration);
    return () => clearTimeout(timer);
  }, [toast, duration, onClose]);

  if (!toast || !toast.message) return null;

  const tipo = toast.type || "info";
  const isError = tipo === "error";
  const isSuccess = tipo === "success";

  const toneClasses = isError
    ? "bg-[#FFF5F5] border-[#EF9A9A] text-[#B71C1C]"
    : isSuccess
    ? "bg-[#F1F8F3] border-[#A5D6A7] text-[#1B5E20]"
    : "bg-white border-[#D4D4D4] text-[#1A1A1A]";

  const iconName = isError ? "error" : isSuccess ? "check_circle" : "info";
  const iconTone = isError
    ? "text-[#C62828]"
    : isSuccess
    ? "text-[#2E7D32]"
    : "text-[#8B5A2B]";

  return (
    <div
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
      className={`fixed bottom-4 right-4 z-[60] max-w-md w-[calc(100vw-2rem)] sm:w-auto px-4 py-3 rounded-xs border shadow-lg flex items-start gap-3 text-xs ${toneClasses}`}
    >
      <Icon name={iconName} className={`w-4 h-4 shrink-0 mt-0.5 ${iconTone}`} />
      <p className="flex-1 leading-relaxed break-words">{toast.message}</p>
      <button
        type="button"
        onClick={onClose}
        aria-label="Fechar notificação"
        className="p-0.5 rounded-xs opacity-70 hover:opacity-100 transition-opacity cursor-pointer shrink-0"
      >
        <Icon name="close" className="w-4 h-4" />
      </button>
    </div>
  );
}
