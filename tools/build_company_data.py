#!/usr/bin/env python3
"""Turn an SEC EDGAR "companyfacts" JSON file into the compact data file the app reads.

  curl -H "User-Agent: <app name> <contact>" \
       https://data.sec.gov/api/xbrl/companyfacts/CIK0000796343.json -o adbe_facts.json
  python3 tools/build_company_data.py adbe_facts.json ADBE data/adbe.json

Works with whatever a company files: US GAAP or IFRS, any reporting currency, annual-only
filers, and short histories. Annual values come from full-year facts. Quarterly flow values are
taken from three-month facts where reported and otherwise derived from year-to-date figures
(Q2 = 6M - Q1, Q4 = FY - 9M), which is how cash-flow items are filed.
"""
import json, sys
from collections import Counter
from datetime import date, timedelta

# key -> (label, kind, candidate tags in order of preference; "ifrs:" marks the IFRS taxonomy)
# kind: "flow" (summed over a period), "stock" (point in time), "pershare", "avg" (period average)
SERIES = {
    "revenue": ("Revenue", "flow", ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet", "SalesRevenueGoodsNet", "RevenuesNetOfInterestExpense", "RevenuesExcludingInterestAndDividends", "RegulatedAndUnregulatedOperatingRevenue", "RealEstateRevenueNet", "OperatingLeasesIncomeStatementLeaseRevenue", "ifrs:Revenue", "ifrs:RevenueFromContractsWithCustomers", "ifrs:RevenueFromSaleOfGoods"]),
    "nii": ("Net interest income", "flow", ["InterestIncomeExpenseNet", "InterestIncomeExpenseAfterProvisionForLoanLoss", "ifrs:InterestRevenueExpense"]),
    "nonIntInc": ("Non-interest income", "flow", ["NoninterestIncome"]),
    "cogs": ("Cost of revenue", "flow", ["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfGoodsSold", "ifrs:CostOfSales"]),
    "grossProfit": ("Gross profit", "flow", ["GrossProfit", "ifrs:GrossProfit"]),
    "rd": ("R&D expense", "flow", ["ResearchAndDevelopmentExpenseSoftwareExcludingAcquiredInProcessCost", "ResearchAndDevelopmentExpense", "ifrs:ResearchAndDevelopmentExpense"]),
    "sm": ("Sales & marketing expense", "flow", ["SellingAndMarketingExpense", "ifrs:SalesAndMarketingExpense"]),
    "ga": ("G&A expense", "flow", ["GeneralAndAdministrativeExpense", "ifrs:AdministrativeExpense"]),
    "sga": ("SG&A expense", "flow", ["SellingGeneralAndAdministrativeExpense", "ifrs:SellingGeneralAndAdministrativeExpense"]),
    "opex": ("Operating expenses", "flow", ["OperatingExpenses"]),
    "opInc": ("Operating income", "flow", ["OperatingIncomeLoss", "ifrs:ProfitLossFromOperatingActivities"]),
    "pretax": ("Pre-tax income", "flow", ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest", "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments", "ifrs:ProfitLossBeforeTax"]),
    "tax": ("Income tax", "flow", ["IncomeTaxExpenseBenefit", "ifrs:IncomeTaxExpenseContinuingOperations"]),
    "netInc": ("Net income", "flow", ["NetIncomeLoss", "NetIncomeLossAvailableToCommonStockholdersBasic", "ProfitLoss", "ifrs:ProfitLossAttributableToOwnersOfParent", "ifrs:ProfitLoss"]),
    "epsDil": ("EPS (diluted)", "pershare", ["EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted", "EarningsPerShareBasic", "ifrs:DilutedEarningsLossPerShare", "ifrs:BasicEarningsLossPerShare"]),
    "sharesDil": ("Diluted shares (weighted avg)", "avg", ["WeightedAverageNumberOfDilutedSharesOutstanding", "WeightedAverageNumberOfShareOutstandingBasicAndDiluted", "WeightedAverageNumberOfSharesOutstandingBasic", "ifrs:AdjustedWeightedAverageShares", "ifrs:WeightedAverageShares"]),
    "sbc": ("Stock-based compensation", "flow", ["ShareBasedCompensation", "AllocatedShareBasedCompensationExpense", "ifrs:AdjustmentsForSharebasedPayments"]),
    "da": ("Depreciation & amortisation", "flow", ["DepreciationDepletionAndAmortization", "DepreciationAndAmortization", "ifrs:DepreciationAndAmortisationExpense"]),
    "cfo": ("Operating cash flow", "flow", ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations", "ifrs:CashFlowsFromUsedInOperatingActivities"]),
    "capex": ("Capital expenditure", "flow", ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets", "ifrs:PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities"]),
    "buybacks": ("Share repurchases", "flow", ["PaymentsForRepurchaseOfCommonStock", "ifrs:PaymentsToAcquireOrRedeemEntitysShares"]),
    "dividends": ("Dividends paid", "flow", ["PaymentsOfDividends", "PaymentsOfDividendsCommonStock", "ifrs:DividendsPaidClassifiedAsFinancingActivities", "ifrs:DividendsPaid"]),
    "acquisitions": ("Acquisitions (cash paid)", "flow", ["PaymentsToAcquireBusinessesNetOfCashAcquired"]),
    "cash": ("Cash & equivalents", "stock", ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents", "CashAndDueFromBanks", "ifrs:CashAndCashEquivalents"]),
    "sti": ("Short-term investments", "stock", ["ShortTermInvestments", "MarketableSecuritiesCurrent", "AvailableForSaleSecuritiesCurrent"]),
    "ltInv": ("Long-term marketable securities", "stock", ["MarketableSecuritiesNoncurrent", "AvailableForSaleSecuritiesNoncurrent"]),
    "commercialPaper": ("Commercial paper", "stock", ["CommercialPaper"]),
    "receivables": ("Accounts receivable", "stock", ["AccountsReceivableNetCurrent", "ifrs:TradeAndOtherCurrentReceivables"]),
    "payables": ("Accounts payable", "stock", ["AccountsPayableCurrent", "ifrs:TradeAndOtherCurrentPayables"]),
    "curAssets": ("Current assets", "stock", ["AssetsCurrent", "ifrs:CurrentAssets"]),
    "curLiab": ("Current liabilities", "stock", ["LiabilitiesCurrent", "ifrs:CurrentLiabilities"]),
    "assets": ("Total assets", "stock", ["Assets", "ifrs:Assets"]),
    "liabilities": ("Total liabilities", "stock", ["Liabilities", "ifrs:Liabilities"]),
    "equity": ("Shareholders' equity", "stock", ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest", "ifrs:EquityAttributableToOwnersOfParent", "ifrs:Equity"]),
    "goodwill": ("Goodwill", "stock", ["Goodwill", "ifrs:Goodwill"]),
    "debtLT": ("Long-term debt", "stock", ["LongTermDebtNoncurrent", "LongTermDebt", "ifrs:LongtermBorrowings"]),
    "debtCur": ("Current debt", "stock", ["DebtCurrent", "LongTermDebtCurrent", "ifrs:ShorttermBorrowings", "ifrs:CurrentBorrowingsAndCurrentPortionOfNoncurrentBorrowings"]),
    "deferredRev": ("Deferred revenue", "stock", ["ContractWithCustomerLiabilityCurrent", "DeferredRevenueCurrent"]),
    "rpo": ("Remaining performance obligations", "stock", ["RevenueRemainingPerformanceObligation"]),
    "sharesOut": ("Shares outstanding", "stock", ["CommonStockSharesOutstanding", "ifrs:NumberOfSharesOutstanding"]),
}
ANNUAL_FORMS = {"10-K", "10-KT", "20-F", "40-F", "10-K405"}
CALENDAR_KEYS = ["revenue", "netInc", "cfo", "opInc", "nii", "pretax"]


class Skip(Exception):
    pass


def d(s): return date.fromisoformat(s)
def span(k): return (d(k[1]) - d(k[0])).days
def is_fy(k): return 350 <= span(k) <= 380
def is_q(k): return 80 <= span(k) <= 100


def build(raw, ticker, name=None, max_quarters=None):
    """Return the app's data object for one company, or raise Skip if there is nothing usable."""
    fx = raw.get("facts") or {}
    tax = {"us": fx.get("us-gaap") or {}, "ifrs": fx.get("ifrs-full") or {}}
    if not tax["us"] and not tax["ifrs"]: raise Skip("no financial statements in structured form")

    def node(tag):
        return tax["ifrs"].get(tag[5:]) if tag.startswith("ifrs:") else tax["us"].get(tag)

    # Reporting currency: the one most used for the headline figures in the last five years.
    count, latest = Counter(), "0000"
    for key in ("revenue", "netInc", "assets"):
        for tag in SERIES[key][2]:
            for unit, arr in ((node(tag) or {}).get("units") or {}).items():
                if len(unit) == 3 and unit.isupper():
                    for f in arr: latest = max(latest, f["end"])
    floor = str(int(latest[:4]) - 5) + latest[4:] if latest != "0000" else "0000"
    for key in ("revenue", "netInc", "assets"):
        for tag in SERIES[key][2]:
            for unit, arr in ((node(tag) or {}).get("units") or {}).items():
                if len(unit) == 3 and unit.isupper(): count[unit] += sum(1 for f in arr if f["end"] >= floor)
    if not count: raise Skip("no income or balance sheet figures")
    cur = count.most_common(1)[0][0]
    units_ok = {cur, cur + "/shares", "shares", "pure"}

    def facts(tags):
        """Merge candidate tags; earlier tags win, and for one period the latest filing wins."""
        dur, inst = {}, {}
        for tag in reversed(tags):
            n = node(tag)
            if not n: continue
            tdur, tinst = {}, {}
            for unit, arr in n["units"].items():
                if unit not in units_ok: continue
                for f in sorted(arr, key=lambda f: f.get("filed", "")):
                    if f.get("start"): tdur[(f["start"], f["end"])] = f["val"]
                    else: tinst[f["end"]] = f["val"]
            dur.update(tdur); inst.update(tinst)
        return dur, inst

    loaded = {k: facts(v[2]) for k, v in SERIES.items()}

    # Fiscal calendar from every headline flow figure the company reports.
    spans = set()
    for k in CALENDAR_KEYS: spans |= set(loaded[k][0])
    annual_ends = set()
    for k in CALENDAR_KEYS:
        for tag in SERIES[k][2]:
            for unit, arr in ((node(tag) or {}).get("units") or {}).items():
                if unit in units_ok:
                    annual_ends |= {f["end"] for f in arr if f.get("start") and is_fy((f["start"], f["end"])) and str(f.get("form", "")).split("/")[0] in ANNUAL_FORMS}
    fy_ends = sorted({k[1] for k in spans if is_fy(k) and (k[1] in annual_ends or not annual_ends)})
    fy_start = {}
    for k in spans:
        if is_fy(k) and k[1] in fy_ends: fy_start[k[1]] = max(fy_start.get(k[1], k[0]), k[0])
    q_all = sorted({k[1] for k in spans if is_q(k)} | set(fy_ends))
    carried = set()
    approx = set()   # periods whose share count is a stand-in (cover page or carried forward)

    # Quarter grid: every fiscal year gets four slots, so a missing quarter leaves a gap
    # rather than shifting its neighbours. Year-to-date-only filers (many foreign companies) fit too.
    sub_ends = sorted({k[1] for k in spans if span(k) < 350} | set(fy_ends))
    periods = []  # {fy, q, end, ystart, label, real}
    if fy_ends:
        prev = (d(fy_start[fy_ends[0]]) - timedelta(days=1)).isoformat()
        for fe in fy_ends + [None]:
            last = fe is None
            ends = [e for e in sub_ends if e > prev and (last or e <= fe)]
            if last and not ends: break
            fy = d(prev).year + 1 if last else d(fe).year
            ystart = None if last else fy_start.get(fe)
            if ystart is None: ystart = min((k[0] for k in spans if k[1] in ends and k[0] > prev), default=(d(prev) + timedelta(days=1)).isoformat())
            slots = {}
            for e in ends:
                qn = 4 if e == fe else max(1, min(4 if last else 3, round((d(e) - d(ystart)).days / 91.3)))
                slots[qn] = e
            for qn in range(1, (max(slots) if last else 4) + 1):
                e = slots.get(qn)
                periods.append({"fy": fy, "q": qn, "end": e or (d(ystart) + timedelta(days=round(qn * 91.3) - 1)).isoformat(), "ystart": ystart, "label": f"Q{qn} FY{str(fy)[2:]}", "real": bool(e)})
            if not last: prev = fe
    else:
        for e in sorted({k[1] for k in spans if is_q(k)}):
            periods.append({"fy": None, "q": None, "end": e, "ystart": None, "label": d(e).strftime("%b %y"), "real": True})
    if not fy_ends and not periods: raise Skip("no annual or quarterly periods")

    # Cover-page share counts, used when the statements carry no share count.
    cover = {}
    for unit, arr in (((fx.get("dei") or {}).get("EntityCommonStockSharesOutstanding") or {}).get("units") or {}).items():
        for f in arr: cover[f["end"]] = f["val"]
    def cover_near(end):
        lo, hi = d(end), d(end) + timedelta(days=120)
        hits = [(e, v) for e, v in cover.items() if lo <= d(e) <= hi and v]
        return min(hits)[1] if hits else None

    def sub_series(key, periods, half):
        """One series over the sub-year periods: quarters, or half-years when `half`."""
        kind = SERIES[key][1]
        dur, inst = loaded[key]
        if kind == "stock": return [inst.get(p["end"]) if p["real"] else None for p in periods]
        out, ytd_prev = [], {}
        for p in periods:
            direct = None if half else next((v for k, v in dur.items() if k[1] == p["end"] and is_q(k)), None)
            ytd = next((v for k, v in dur.items() if k[1] == p["end"] and k[0] == p["ystart"]), None) if p["ystart"] else None
            if ytd is None and half and p["q"] == 2: ytd = next((v for k, v in dur.items() if k[1] == p["end"] and is_fy(k)), None)
            val = direct
            if val is None and ytd is not None and (kind == "flow" or half):
                if p["q"] == 1 or kind == "avg": val = ytd
                elif ytd_prev.get(p["fy"]) is not None: val = round(ytd - ytd_prev[p["fy"]], 4)
            if kind == "flow" and ytd is None and direct is not None and p["fy"] is not None:
                base = ytd_prev.get(p["fy"]) if p["q"] > 1 else 0
                ytd = None if base is None else base + direct
            ytd_prev[p["fy"]] = ytd
            out.append(val)
        return out

    def covered(P, S, slots):
        return sum(1 for i in range(max(0, len(P) - slots), len(P)) if S["revenue"][i] is not None or S["netInc"][i] is not None)

    A, Q, labels, kinds = {}, {}, {}, {}
    for key, (label, kind, tags) in SERIES.items():
        dur, inst = loaded[key]
        A[key] = [inst.get(e) for e in fy_ends] if kind == "stock" else [next((v for k, v in dur.items() if k[1] == e and is_fy(k)), None) for e in fy_ends]
        Q[key], labels[key], kinds[key] = sub_series(key, periods, False), label, ("stock" if kind == "stock" else kind)

    # Companies that file only a half-year report between annual ones get half-year periods instead.
    per = 4
    if fy_ends and covered(periods, Q, 8) < 5:
        halves = [dict(p, q=p["q"] // 2, label=f"H{p['q'] // 2} FY{str(p['fy'])[2:]}") for p in periods if p["q"] in (2, 4)]
        H = {key: sub_series(key, halves, True) for key in SERIES}
        if halves and covered(halves, H, 4) * 2 > covered(periods, Q, 8):
            periods, Q, per = halves, H, 2

    # Q4 EPS and average shares are only reported for the full year.
    for i, p in enumerate(periods):
        if per == 4 and p["q"] == 4 and i >= 3 and p["fy"] in [d(e).year for e in fy_ends]:
            j = [d(e).year for e in fy_ends].index(p["fy"])
            prior = [Q["epsDil"][i - n] for n in (1, 2, 3)]
            direct = next((1 for k in loaded["epsDil"][0] if k[1] == p["end"] and is_q(k)), None)
            if not direct and A["epsDil"][j] is not None and all(v is not None for v in prior):
                Q["epsDil"][i] = round(A["epsDil"][j] - sum(prior), 4)

    def fill(block, ends):
        n = len(ends)
        for i in range(n):
            # Banks: revenue is net interest income plus non-interest income.
            if block["revenue"][i] is None and block["nii"][i] is not None:
                block["revenue"][i] = block["nii"][i] + (block["nonIntInc"][i] or 0)
            if block["grossProfit"][i] is None and block["revenue"][i] is not None and block["cogs"][i] is not None:
                block["grossProfit"][i] = block["revenue"][i] - block["cogs"][i]
            if block["sharesOut"][i] is None:
                block["sharesOut"][i] = cover_near(ends[i])
                if block["sharesOut"][i]: approx.add(ends[i])
            ni, eps, sh = block["netInc"][i], block["epsDil"][i], block["sharesDil"][i]
            if sh is None:
                if ni is not None and eps: sh = round(ni / eps) if abs(ni / eps) > 1000 else None
                if sh is None or sh <= 0: sh = block["sharesOut"][i]
                block["sharesDil"][i] = sh
            if sh is None:  # last resort: a count from no more than a year back
                back = 4 if block is Q else 1
                sh = next((block["sharesDil"][j] for j in range(i - 1, max(-1, i - 1 - back), -1) if block["sharesDil"][j] and ends[j] not in carried), None)
                if sh is None and block is Q:
                    sh = next((A["sharesDil"][j] for j in range(len(fy_ends) - 1, -1, -1) if A["sharesDil"][j] and fy_ends[j] <= ends[i] and (d(ends[i]) - d(fy_ends[j])).days <= 400), None)
                block["sharesDil"][i] = sh
                if sh: approx.add(ends[i]); carried.add(ends[i])
            if eps is None and ni is not None and sh: block["epsDil"][i] = round(ni / sh, 4)
    fill(A, fy_ends); fill(Q, [p["end"] for p in periods])

    # Undo stock splits: older filings report shares and EPS on the pre-split basis.
    def unsplit(block, share_key, eps_key=None):
        sh = block[share_key]
        idx = [i for i, v in enumerate(sh) if v and v > 0]
        factor = 1.0
        for pos in range(len(idx) - 1, 0, -1):
            a, b = idx[pos - 1], idx[pos]
            r = sh[b] / (sh[a] * factor)
            step = None
            if r <= 0: continue
            if r >= 1.8 and abs(r - round(r)) / r < 0.06: step = float(round(r))          # forward split
            elif r <= 0.55 and abs(1 / r - round(1 / r)) * r < 0.06: step = 1 / round(1 / r)  # reverse split
            if step: factor *= step
            if factor != 1.0:
                lo = idx[pos - 2] + 1 if pos >= 2 else 0
                for i in range(lo, a + 1):
                    if sh[i]: sh[i] = round(sh[i] * factor)
                    if eps_key and block[eps_key][i] is not None: block[eps_key][i] = round(block[eps_key][i] / factor, 4)
    for block in (A, Q):
        unsplit(block, "sharesDil", "epsDil"); unsplit(block, "sharesOut")

    for key in list(labels):
        if all(v is None for v in A[key]) and all(v is None for v in Q[key]):
            del A[key], Q[key], labels[key], kinds[key]
    if "netInc" not in labels and "revenue" not in labels and "assets" not in labels: raise Skip("no income or balance sheet figures")

    # Drop the years before quarterly reporting starts, and quarters altogether if there are too few.
    def has(i): return any(Q.get(k) and Q[k][i] is not None for k in ("revenue", "netInc", "cfo"))
    first = next((i for i in range(len(periods)) if has(i)), len(periods))
    if sum(1 for i in range(first, len(periods)) if has(i)) < 2: first = len(periods)
    if first and periods and periods[0]["fy"] is not None: first -= first % per if first < len(periods) else 0
    periods = periods[first:]
    for k in Q: Q[k] = Q[k][first:]
    if max_quarters and len(periods) > max_quarters * per // 4:
        cut = len(periods) - max_quarters * per // 4
        periods = periods[cut:]
        for k in Q: Q[k] = Q[k][cut:]
    ends = fy_ends + [p["end"] for i, p in enumerate(periods) if p["real"] and has(i)]
    return {
        "ticker": ticker, "name": name or raw.get("entityName", ticker).title(), "cik": raw.get("cik"),
        "source": "SEC EDGAR XBRL company facts (" + ("annual and quarterly reports" if periods else "annual reports") + ")",
        "latestPeriodEnd": max(ends), "currency": cur, "sharesApprox": max(ends) in approx, "standard": "IFRS" if tax["ifrs"] and not tax["us"] else "US GAAP",
        "labels": labels, "kinds": kinds,
        "annual": {"fy": [d(e).year for e in fy_ends], "end": fy_ends, "series": A},
        "quarterly": {"per": per, "label": [p["label"] for p in periods], "end": [p["end"] for p in periods], "fy": [p["fy"] for p in periods], "q": [p["q"] for p in periods], "series": Q},
    }


def main(src, ticker, out):
    obj = build(json.load(open(src)), ticker)
    json.dump(obj, open(out, "w"), separators=(",", ":"))
    print(f"{ticker}: {len(obj['annual']['fy'])} fiscal years, {len(obj['quarterly']['label'])} quarters to {obj['latestPeriodEnd']}, {len(obj['labels'])} series, {obj['currency']} -> {out}")


if __name__ == "__main__":
    if len(sys.argv) != 4: sys.exit(__doc__)
    main(*sys.argv[1:])
