import { useState, useEffect } from "react";

/**
 * Hook para adiar a emissão de um valor após um período de inatividade na digitação.
 * Previne rajadas de requisições HTTP ao backend enquanto o usuário digita nos filtros.
 *
 * @param {any} value - Valor monitorado (ex: texto do input)
 * @param {number} delay - Tempo de espera em milissegundos (padrão: 350ms)
 * @returns {any} Valor com debounce aplicado
 */
export function useDebounce(value, delay = 350) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return debouncedValue;
}
