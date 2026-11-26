"""Exporta, do banco SQLite oficial da Calculadora RTC (Receita Federal/Serpro),
os dados usados pelo site: classificacoes tributarias (cClassTrib), percentuais de
reducao, vinculos NCM/NBS x cClassTrib (anexos da LC 214/2025), NCM e NBS.

Uso: python3 tools/export_data.py <caminho/calculadora-pro.db> <data AAAA-MM-DD> <dir_saida>
O banco e gerado pelo flyway do repositorio ReceitaFederal/calculadora-rtc-regime-regular.
"""
import json, sqlite3, sys, os, re

db, D, out = sys.argv[1], sys.argv[2], sys.argv[3]
c = sqlite3.connect(db)
q = lambda s, *a: c.execute(s, a).fetchall()
VIG = lambda p: f"? between {p}_INICIO_VIGENCIA and coalesce({p}_FIM_VIGENCIA, ?)"

MONO = {23, 24, 25, 26, 27, 28, 41, 42}
EXCLUIR_CST = {"220", "221", "620", "800", "810", "811", "820", "830"}

dfe = {}
for cl, sig in q(f"select t.TDCL_CLTR_ID, d.TPDF_SIGLA from TIPO_DFE_CLASSIFICACAO t join TIPO_DFE d on d.TPDF_ID=t.TDCL_TPDF_ID where {VIG('t.TDCL')}", D, D):
    dfe.setdefault(cl, set()).add(sig)

trt = {r[0]: r for r in q("select TRTR_ID, TRTR_DESCRICAO, TRTR_EXPRESSAO_ALIQUOTA, TRTR_EXPRESSAO_BASE_CALCULO, TRTR_EXPRESSAO_PERCENTUAL_DIFERIMENTO, TRTR_IN_POSSUI_AJUSTE, TRTR_IN_EXIGE_GRUPO_DESONERACAO from TRATAMENTO_TRIBUTARIO")}

rows = q(f"""select c.CLTR_ID, c.CLTR_CD, s.SITR_CD, s.SITR_IND_GIBSCBS, s.SITR_DESCRICAO, c.CLTR_DESCRICAO, c.CLTR_TIPO_ALIQUOTA,
  c.CLTR_NOMENCLATURA, c.CLTR_IN_APROPRIACAO_CREDITOS_ADQUIRENTES_CBS, c.CLTR_IN_APROPRIACAO_CREDITOS_ADQUIRENTES_IBS, t.TRCL_TRTR_ID
  from CLASSIFICACAO_TRIBUTARIA c join SITUACAO_TRIBUTARIA s on s.SITR_ID=c.CLTR_SITR_ID
  join TRATAMENTO_CLASSIFICACAO t on t.TRCL_CLTR_ID=c.CLTR_ID and {VIG('t.TRCL')}
  where {VIG('c.CLTR')} and s.SITR_ID<=18 order by c.CLTR_CD""", D, D, D, D)

classes, ids = [], {}
for (cid, cod, cst, gibs, cstdesc, desc, tipo, nom, crcbs, cribs, tr) in rows:
    t = trt[tr]
    if tr in MONO or cst in EXCLUIR_CST or t[5] or t[6] or tipo.startswith("Alíquotas Combinadas"):
        continue
    sig = dfe.get(cid, set())
    docs = sorted(x for x in sig if x in ("NF-e", "NFC-e", "NFS-e"))
    if not docs:
        continue
    red = {}
    for tb, v in q(f"select PERE_TBTO_ID, PERE_VALOR from PERCENTUAL_REDUCAO where PERE_CLTR_ID=? and {VIG('PERE')}", cid, D, D):
        red[{2: "cbs", 3: "ibsUf", 4: "ibsMun"}[tb]] = v
    temNcm = bool(q(f"select 1 from NCM_APLICAVEL where NCMA_CLTR_ID=? and {VIG('NCMA')} limit 1", cid, D, D))
    temNbs = bool(q(f"select 1 from NBS_APLICAVEL where NBSA_CLTR_ID=? and {VIG('NBSA')} limit 1", cid, D, D))
    base = t[3]
    baseFator = 0.5 if base == "baseCalculoInformada*0.5" else (0 if "(1-100/100)" in base else 1)
    ids[cid] = cod
    classes.append(dict(c=cod, cst=cst, cstDesc=cstdesc, d=re.sub(r"\s+", " ", desc).strip(), tipo=tipo,
                        trat=t[1], aliqZero=(t[2] or "").strip() == "0", baseFator=baseFator,
                        dif=bool(t[4]), gIBSCBS=bool(gibs), red=red, nom=nom, docs=docs,
                        cred=bool(crcbs) or bool(cribs), anexoNcm=temNcm, anexoNbs=temNbs))

# vinculos NCM (com excecoes) e NBS
ncmA = []
for nid, pref, cl in q(f"select NCMA_ID, NCMA_NCM_CD, NCMA_CLTR_ID from NCM_APLICAVEL where {VIG('NCMA')}", D, D):
    if cl not in ids: continue
    ex = [r[0] for r in q(f"select ENCM_NCM_CD from EXCECAO_NCM_APLICAVEL where ENCM_NCMA_ID=? and {VIG('ENCM')}", nid, D, D)]
    ncmA.append([pref, ids[cl], ex] if ex else [pref, ids[cl]])
nbsA = []
for pref, cl in q(f"select NBSA_NBS_CD, NBSA_CLTR_ID from NBS_APLICAVEL where {VIG('NBSA')}", D, D):
    if cl in ids: nbsA.append([pref, ids[cl]])
# sugestao de cClassTrib por NBS (correlacao NBS x LC 116 x cClassTrib publicada para a NFS-e)
nbsSug = {}
for nbs, lc, cl in q(f"select CNIL_NBS_CD, CNIL_LSLC_CD, CNIL_CLTR_ID from CLASSIF_NBS_INDOP_LC where {VIG('CNIL')} and CNIL_IN_PS_ONEROSA=1 and CNIL_IN_ADQ_EXTERIOR=0", D, D):
    e = nbsSug.setdefault(nbs, {"lc": set(), "c": set()})
    e["lc"].add(lc)
    if cl in ids: e["c"].add(ids[cl])
nbsSug = {k: {"lc": sorted(v["lc"]), "c": sorted(v["c"])} for k, v in nbsSug.items()}

strip = lambda s: re.sub(r"<[^>]+>", "", s or "").strip()
ncm = [[a, strip(b)] for a, b in q(f"select NCM_CD, NCM_DESCRICAO from NCM where {VIG('NCM')} order by NCM_CD", D, D)]
nbs = [[a, strip(b)] for a, b in q("select NBS_CD, NBS_DESCRICAO from NBS where ? between NBS_INICIO_VIGENCIA and coalesce(NBS_FIM_VIGENCIA, ?) order by NBS_CD", D, D)]
lc116 = {a: strip(b) for a, b in q(f"select LSLC_CD, LSLC_DESCRICAO from LISTA_SERVICOS_LC_116 where {VIG('LSLC')}", D, D)}
# NCM sujeitos ao Imposto Seletivo (a partir de 2027): o IS integra a base da CBS/IBS
isNcm = [r[0] for r in q(f"""select p.AAVP_NCM_CD from ALIQUOTA_AD_VALOREM_PRODUTO p join ALIQUOTA_AD_VALOREM a on a.AADV_ID=p.AAVP_AADV_ID
  where a.AADV_TBTO_ID=1 and {VIG('p.AAVP')} and not exists (select 1 from EXCECAO_AD_VALOREM_PRODUTO e where e.EAVP_AAVP_ID=p.AAVP_ID and {VIG('e.EAVP')})""", D, D, D, D)]
versao = q("select VRBD_VERSAO_BASE_DADO, VRBD_DATA, VRBD_DESCRICAO from VERSAO_BASE_DADO order by VRBD_ID desc limit 1")[0]

os.makedirs(out, exist_ok=True)
meta = dict(dataReferencia=D, versaoBase=versao[0], dataBase=versao[1],
            fonte="ReceitaFederal/calculadora-rtc-regime-regular (banco SQLite oficial, flyway)")
dump = lambda name, obj: json.dump(obj, open(os.path.join(out, name), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
dump("rtc.json", dict(meta=meta, classes=classes, ncmA=ncmA, nbsA=nbsA, nbsSug=nbsSug, lc116=lc116, isNcm=sorted(set(isNcm))))
dump("ncm.json", ncm)
dump("nbs.json", nbs)
print(meta, "classes", len(classes), "ncmA", len(ncmA), "nbsA", len(nbsA), "nbsSug", len(nbsSug), "ncm", len(ncm), "nbs", len(nbs))
