import asyncio
import datetime as dt
from getpass import getpass
from pathlib import Path
from typing import List
import httpx

BASE_URL = "http://192.168.0.6"
LOGIN_PAGE = f"{BASE_URL}/home/"
LOGIN_POST = f"{BASE_URL}/home/login/"
FERIADOS_URL = f"{BASE_URL}/pcp/feriados.php"


async def login_client(client: httpx.AsyncClient, usuario: str, senha: str) -> None:
    # 1) GET inicial (gera PHPSESSID)
    await client.get(LOGIN_PAGE, timeout=10.0)

    # 2) POST multipart/form-data
    resp = await client.post(
        LOGIN_POST,
        files={
            "pagina_acessada": (None, f"{BASE_URL}/home/app"),
            "action": (None, "login"),
            "usuario": (None, usuario),
            "senha": (None, senha),
            "logar": (None, "Acessar"),
        },
        headers={
            "Referer": LOGIN_PAGE,
            "Origin": BASE_URL,
            "User-Agent": "Mozilla/5.0",
        },
        timeout=10.0,
    )
    resp.raise_for_status()

    # Verifica se sessão foi estabelecida
    cookies = client.cookies
    if "/home/app" not in str(resp.url) and "PHPSESSID" not in cookies:
        raise RuntimeError("Login não estabeleceu sessão")
    print("Login OK")


async def coletar_feriados_ano(
    client: httpx.AsyncClient,
    anos: List[int] = [2025, 2026, 2027],
    max_concorrencia: int = 15,
) -> List[str]:
    datas_consultar = []
    for ano in anos:
        data = dt.date(ano, 1, 1)
        fim = dt.date(ano, 12, 31)
        while data <= fim:
            if data.weekday() < 5:
                datas_consultar.append(data.isoformat())
            data += dt.timedelta(days=1)

    total = len(datas_consultar)
    print(f"Total de dias úteis a verificar: {total}")

    sem = asyncio.Semaphore(max_concorrencia)
    datas_feriados = []
    processados = 0

    async def _consultar_dia(data_str: str):
        nonlocal processados
        async with sem:
            try:
                r = await client.get(
                    FERIADOS_URL,
                    params={"dat_ref": data_str},
                    timeout=10.0,
                )
                r.raise_for_status()
                js = r.json()
                if js.get("success") and js.get("data"):
                    for item in js["data"]:
                        if item.get("ies_situa") == "3":
                            datas_feriados.append(item["dat_ref"])
            except Exception as e:
                print(f"Erro ao consultar {data_str}: {e}")
            finally:
                processados += 1
                if processados % 50 == 0 or processados == total:
                    print(f"Progresso: {processados}/{total} dias...")

    await asyncio.gather(*[_consultar_dia(d) for d in datas_consultar])
    return sorted(set(datas_feriados))


async def main():
    usuario = input("Usuário: ")
    senha = getpass("Senha: ")

    async with httpx.AsyncClient(follow_redirects=True) as client:
        await login_client(client, usuario, senha)
        feriados = await coletar_feriados_ano(client)

    base_dir = Path(__file__).resolve().parent
    arquivo = base_dir / "feriados.txt"
    with open(arquivo, "w", encoding="utf-8") as f:
        for d in feriados:
            f.write(f"{d}\n")
    print(f"Arquivo {arquivo} gerado com sucesso ({len(feriados)} feriados encontrados).")


if __name__ == "__main__":
    asyncio.run(main())
