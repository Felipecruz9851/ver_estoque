import { formatarQtd, truncar } from "./formatters";

/**
 * Exporta uma tabela da Matriz Pivot como imagem PNG de alta definição (por fábrica do componente).
 */
export const exportarTabelaMatrizComoImagem = ({
  tituloPrincipal,
  subtitulo,
  itens,
  prazosCols,
  nomeArquivoBase = "tabela_faltantes",
}) => {
  try {
    if (!itens || itens.length === 0) {
      alert("Não há linhas nesta tabela para gerar a imagem.");
      return;
    }

    const colsPrazoEfetivas =
      prazosCols && prazosCols.length > 0
        ? prazosCols
        : [
            { prazo: 10, key: "10", label: "R. Multimarcas e Nordeste" },
            { prazo: 3, key: "3", label: "MG e franquia" },
            { prazo: 8, key: "8", label: "Fora de MG" },
          ];

    const colunas = [
      { key: "item", label: "Componente", width: 150, align: "left", mono: true, bold: true },
      { key: "descricao", label: "Descrição", width: 320, align: "left" },
      ...colsPrazoEfetivas.map((colP) => ({
        key: `prazo_${colP.key}`,
        prazoKey: colP.key,
        label: colP.label,
        width: 150,
        align: "right",
        mono: true,
        isPrazo: true,
      })),
      {
        key: "falta_total",
        label: "Total Faltante",
        width: 145,
        align: "right",
        mono: true,
        isTotal: true,
      },
      {
        key: "op_saldo_ate_d1",
        label: "Saldo da ops do item com abertura menor ou igual a hoje+1",
        width: 210,
        align: "right",
        mono: true,
        isOpAteD1: true,
      },
      {
        key: "op_saldo_apos_d1",
        label: "Saldo das OPs com abertura maior que hoje+1",
        width: 200,
        align: "right",
        mono: true,
        isOpAposD1: true,
      },
    ];

    const padX = 24;
    const padY = 20;
    const headerBannerH = 66;
    const tableHeaderH = 46;
    const rowH = 30;
    const footerH = 38;

    const tableW = colunas.reduce((acc, c) => acc + c.width, 0);
    const totalW = tableW + padX * 2;
    const totalH =
      padY * 2 + headerBannerH + tableHeaderH + itens.length * rowH + footerH;

    const scale = 2; // 2x Retina para máxima nitidez
    const canvas = document.createElement("canvas");
    canvas.width = totalW * scale;
    canvas.height = totalH * scale;
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);

    // Fundo geral branco
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, totalW, totalH);

    // Banner superior institucional
    ctx.fillStyle = "#1A1A1A";
    ctx.fillRect(padX, padY, tableW, headerBannerH);

    ctx.fillStyle = "#FFFFFF";
    ctx.font = "bold 16px Montserrat, Inter, Segoe UI, Arial, sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText(tituloPrincipal || "Faltantes Produzidos por Fábrica", padX + 16, padY + 24);

    ctx.fillStyle = "#D4D4D4";
    ctx.font = "12px Inter, Segoe UI, Arial, sans-serif";
    const dataGeracao = new Date().toLocaleString("pt-BR");
    const subTexto = `${subtitulo || ""} • ${itens.length} componente(s) • Gerado em ${dataGeracao}`;
    ctx.fillText(subTexto, padX + 16, padY + 47);

    // Cabeçalho da tabela
    const yHead = padY + headerBannerH;
    let curX = padX;
    colunas.forEach((col) => {
      if (col.isPrazo) {
        ctx.fillStyle = "#F8F8F8";
      } else if (col.isTotal) {
        ctx.fillStyle = "#FBF7F4";
      } else {
        ctx.fillStyle = "#F8F8F8";
      }
      ctx.fillRect(curX, yHead, col.width, tableHeaderH);

      ctx.strokeStyle = "#E8E8E8";
      ctx.lineWidth = 1;
      ctx.strokeRect(curX, yHead, col.width, tableHeaderH);

      ctx.fillStyle = col.isTotal ? "#8B5A2B" : "#222222";
      ctx.font = "bold 11px Inter, Segoe UI, Arial, sans-serif";
      ctx.textAlign = col.align === "right" ? "right" : col.align === "center" ? "center" : "left";
      const textX =
        col.align === "right"
          ? curX + col.width - 10
          : col.align === "center"
          ? curX + col.width / 2
          : curX + 10;

      if (col.label.length > 26) {
        const maxW = col.width - 18;
        const palavras = col.label.split(/\s+/);
        let linha1 = "";
        let idxPalavra = 0;
        while (idxPalavra < palavras.length) {
          const cand = linha1 ? `${linha1} ${palavras[idxPalavra]}` : palavras[idxPalavra];
          if (ctx.measureText(cand).width <= maxW || !linha1) {
            linha1 = cand;
            idxPalavra += 1;
          } else {
            break;
          }
        }
        const linha2 = palavras.slice(idxPalavra).join(" ");
        if (linha2) {
          ctx.fillText(linha1, textX, yHead + tableHeaderH / 2 - 7, maxW);
          ctx.fillText(linha2, textX, yHead + tableHeaderH / 2 + 7, maxW);
        } else {
          ctx.fillText(linha1, textX, yHead + tableHeaderH / 2, maxW);
        }
      } else {
        ctx.fillText(truncar(col.label, 26), textX, yHead + tableHeaderH / 2);
      }
      curX += col.width;
    });

    // Linhas de dados e cálculo de subtotais
    const subtotaisPrazo = {};
    colsPrazoEfetivas.forEach((colP) => {
      subtotaisPrazo[colP.key] = 0;
    });
    let subtotalFaltaGeral = 0;
    let subtotalOpAteD1 = 0;
    let subtotalOpAposD1 = 0;

    // Pré-cálculo dos subtotais para exibição na linha de topo
    itens.forEach((row) => {
      subtotalFaltaGeral += Number(row.falta_total || 0);
      subtotalOpAteD1 += Number(row.op_saldo_ate_d1 || 0);
      subtotalOpAposD1 += Number(row.op_saldo_apos_d1 || 0);
      colsPrazoEfetivas.forEach((colP) => {
        subtotaisPrazo[colP.key] =
          (subtotaisPrazo[colP.key] || 0) + Number(row.falta_por_prazo?.[colP.key] || 0);
      });
    });

    // Linha de SUBTOTAL POR PRAZO DE ENTREGA no topo (logo após o cabeçalho)
    const ySubtotal = yHead + tableHeaderH;
    let xFoot = padX;
    const idxFimAntesPrazos = 2; // Componente + Descrição
    const larguraBlocoLabel = colunas
      .slice(0, idxFimAntesPrazos)
      .reduce((acc, c) => acc + c.width, 0);

    // Célula mesclada do rótulo "SUBTOTAL POR PRAZO DE ENTREGA"
    ctx.fillStyle = "#F4F4F4";
    ctx.fillRect(xFoot, ySubtotal, larguraBlocoLabel, footerH);
    ctx.strokeStyle = "#E0E0E0";
    ctx.lineWidth = 1;
    ctx.strokeRect(xFoot, ySubtotal, larguraBlocoLabel, footerH);

    ctx.fillStyle = "#1A1A1A";
    ctx.font = "bold 11px Inter, Segoe UI, Arial, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(
      `SUBTOTAL POR PRAZO DE ENTREGA (${itens.length} itens):`,
      xFoot + larguraBlocoLabel - 12,
      ySubtotal + footerH / 2
    );
    xFoot += larguraBlocoLabel;

    // Células de subtotal para cada prazo e total geral
    colunas.slice(idxFimAntesPrazos).forEach((col) => {
      let cellBg = "#F4F4F4";
      let txtColor = "#1A1A1A";
      let textoSub = "";

      if (col.isPrazo) {
        const somaP = subtotaisPrazo[col.prazoKey] || 0;
        cellBg = "#F4F4F4";
        txtColor = "#1A1A1A";
        textoSub = formatarQtd(somaP);
      } else if (col.isTotal) {
        cellBg = "#FBF7F4";
        txtColor = "#8B5A2B";
        textoSub = formatarQtd(subtotalFaltaGeral);
      } else if (col.isOpAteD1 || col.isOpAposD1) {
        const somaOp = col.isOpAteD1 ? subtotalOpAteD1 : subtotalOpAposD1;
        cellBg = "#F4F4F4";
        txtColor = "#1A1A1A";
        textoSub = formatarQtd(somaOp);
      }

      ctx.fillStyle = cellBg;
      ctx.fillRect(xFoot, ySubtotal, col.width, footerH);
      ctx.strokeStyle = "#E0E0E0";
      ctx.lineWidth = 1;
      ctx.strokeRect(xFoot, ySubtotal, col.width, footerH);

      if (textoSub) {
        ctx.fillStyle = txtColor;
        ctx.font = "bold 12px JetBrains Mono, Consolas, monospace";
        ctx.textAlign = "right";
        ctx.fillText(textoSub, xFoot + col.width - 10, ySubtotal + footerH / 2);
      }
      xFoot += col.width;
    });

    // Linhas de dados dos itens (após a linha de subtotal no topo)
    itens.forEach((row, idx) => {
      const yRow = ySubtotal + footerH + idx * rowH;
      const bgBase = idx % 2 === 0 ? "#FFFFFF" : "#FAFAFA";

      let xCell = padX;
      colunas.forEach((col) => {
        let valTexto = "-";
        let txtColor = "#222222";
        let cellBg = bgBase;
        let isBold = Boolean(col.bold);

        if (col.key === "item") {
          valTexto = truncar(row.item, 22);
        } else if (col.key === "descricao") {
          valTexto = truncar(row.descricao, 45);
          txtColor = "#424242";
        } else if (col.isPrazo) {
          const vP = Number(row.falta_por_prazo?.[col.prazoKey] || 0);
          valTexto = vP > 0 ? formatarQtd(vP) : "-";
          if (vP > 0) {
            cellBg = "#F8F8F8";
            txtColor = "#1A1A1A";
            isBold = true;
          } else {
            txtColor = "#BDBDBD";
          }
        } else if (col.isTotal) {
          valTexto = formatarQtd(row.falta_total || 0);
          cellBg = "#FBF7F4";
          txtColor = "#8B5A2B";
          isBold = true;
        } else if (col.isOpAteD1 || col.isOpAposD1) {
          const v = Number(row[col.key] || 0);
          valTexto = v > 0 ? formatarQtd(v) : "-";
          txtColor = v > 0 ? "#1A1A1A" : "#BDBDBD";
          isBold = v > 0;
        }

        ctx.fillStyle = cellBg;
        ctx.fillRect(xCell, yRow, col.width, rowH);

        ctx.strokeStyle = "#EFEFEF";
        ctx.lineWidth = 1;
        ctx.strokeRect(xCell, yRow, col.width, rowH);

        ctx.fillStyle = txtColor;
        const fontFam = col.mono
          ? "JetBrains Mono, Consolas, monospace"
          : "Inter, Segoe UI, Arial, sans-serif";
        ctx.font = `${isBold ? "bold " : ""}11px ${fontFam}`;
        ctx.textAlign =
          col.align === "right" ? "right" : col.align === "center" ? "center" : "left";
        const tx =
          col.align === "right"
            ? xCell + col.width - 10
            : col.align === "center"
            ? xCell + col.width / 2
            : xCell + 10;
        ctx.fillText(valTexto, tx, yRow + rowH / 2);

        xCell += col.width;
      });
    });

    // Dispara o download do PNG
    const slug = String(nomeArquivoBase || "tabela")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .toLowerCase();
    const dataStr = new Date().toISOString().slice(0, 10);

    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `faltantes_${slug}_${dataStr}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }, "image/png");
  } catch (err) {
    alert("Erro ao gerar imagem da tabela: " + err.message);
  }
};
