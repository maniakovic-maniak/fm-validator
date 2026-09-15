<!-- Naming and routing decision: use the user-required filename config/skill-corporate.md for the narrow domain “FMCG and Beverage Integrated Operating Models”; propose DOMAIN_ALIASES.fmcg_beverage = ["FMCG operating model", "consumer packaged goods model", "CPG operating model", "branded consumer goods model", "beverage operating model", "brewing financial model", "brewery operating model", "beer volume model", "spirits operating model", "soft drinks bottling model", "beverage bottler model"]; “corporate” is a filename only and is not a routing alias. -->

# Skill Corporate — FMCG and Beverage Integrated Operating Models

This conditional reference supplies Tier 2 with knowledge specific to branded fast-moving consumer
goods, brewing, spirits and non-alcoholic beverage operating models. It does not define the review
process, evidence rules, status vocabulary, confidence scale, citations or output schema; those remain
owned by the universal checklist and core skill.

## Model type and routing boundary

Apply this reference where the workbook models a branded manufacturer, brewer, distiller, beverage
bottler or integrated consumer-goods business through product/SKU, pack, channel, customer,
geography, production, inventory and route-to-market drivers.

This domain is narrow enough to avoid the confirmed Carlsberg failure mode: it is an industry-plus-
archetype classification, not a synonym for an ordinary company model. A Carlsberg model described
as a brewery, beer-volume, beverage or FMCG operating model should match; a model described only as
a company, group, business, budget or forecast should not.

Proposed classifier entry:

```js
fmcg_beverage: [
  "FMCG operating model",
  "consumer packaged goods model",
  "CPG operating model",
  "branded consumer goods model",
  "beverage operating model",
  "brewing financial model",
  "brewery operating model",
  "beer volume model",
  "spirits operating model",
  "soft drinks bottling model",
  "beverage bottler model"
]
```

Do not add bare aliases such as `company`, `business`, `commercial`, `enterprise`, `group`,
`consumer`, `food`, `drink`, `beverage`, `manufacturer`, `retail`, `wholesale`, `budget`, `forecast`
or `financial model`. Those terms do not establish this domain. In particular, do not use the rejected
broad label or any paraphrase of it as a routing alias.

Do not apply this reference to:

- a retailer whose primary economics are store estate, footfall, basket and retail gross margin;
- a restaurant, hotel, venue or hospitality model driven by seats, rooms or covers;
- an agricultural grower or commodity producer without branded downstream FMCG economics;
- a pharmaceutical, medical-device or durable-goods manufacturer;
- a pure logistics, wholesale or distribution business without brand/SKU economics;
- a standalone valuation, acquisition, treasury or statutory-reporting workbook; or
- a property, infrastructure, mining, regulated utility or project-finance model merely because it
  contains food, beverage, warehouse, factory or office assets.

### In-domain sub-archetypes

| Sub-archetype | Economic signature | Structural implication |
|---|---|---|
| Branded finished-goods manufacturer | Own brands; sources or produces product; sells finished goods to retailers, distributors or consumers | Full SKU/pack/channel revenue, BOM or recipe, conversion cost, inventory, distribution and brand-spend schedules |
| Brewer | Beer and adjacent beverages measured in litres/hectolitres; brewery/packaging capacity; excise; kegs, bottles and cans; returnable packaging may be material | Volume by brand/pack/channel, brewing yield, packaging line, excise, returnable container and route-to-market schedules |
| Distiller / aged spirits producer | New-make production, maturation losses, long-dated maturing inventory, brand/geography/channel mix and excise | Vintage/age inventory cohorts, maturation and angel's-share logic, liquid availability, bottling and finished-goods bridges |
| Soft-drink or water bottler | Territory/franchise rights; concentrate or syrup purchases; unit-case volume; returnable packaging; coolers/vending; local distribution | Concentrate incidence, package conversion, unit-case, franchise, route, cooler, bottle/crate and territory schedules |
| Concentrate / brand owner | High-margin concentrate or royalty revenue through independent bottlers; brand investment and bottler funding | Bottler sell-in, concentrate incidence, royalty, funding, territory and system-volume schedules; manufacturing intensity differs from finished-goods bottlers |
| Hybrid food and beverage group | Foods measured in weight/units and beverages in cases/litres; mixed DSD, warehouse and distributor routes | Separate unit ontologies and margin structures before consolidation; no unqualified aggregation of volume |
| Consumer-health / personal / home-care FMCG | Branded, promotion-sensitive SKUs but no beverage-excise or liquid conversion | Retain SKU, channel, trade-spend, production, inventory and brand logic; suppress beverage-only structures |

## Typical sheet names and structure

Sheet names are indicators, not requirements. Identify the economic function from labels, units,
formulas and dependencies. One sheet may perform several functions and one function may span many
country, brand, customer or category tabs.

### Core workbook map

| Economic function | Common sheet-name indicators | Domain content normally present |
|---|---|---|
| Cover and control | `Cover`, `Control`, `Index`, `Contents`, `README`, `Nav` | version, currency, units, actual/forecast cut-off, selected case, business perimeter |
| Calendar and selling days | `Calendar`, `Timing`, `Periods`, `Selling Days`, `Working Days`, `Seasonality` | fiscal weeks/months, 52/53-week year, selling days, holidays, weather/event flags, actual/forecast boundary |
| Master data | `Master Data`, `SKU Master`, `Product Master`, `Material Master`, `MDM`, `Mapping` | SKU/material codes, brand, category, pack, size, UOM, case configuration, lifecycle status, plant, channel, customer and geography mappings |
| Actuals and source data | `Actuals`, `ERP`, `SAP`, `BW`, `Data`, `Import`, `Cube`, `Power Query`, `Sell In`, `Sell Out`, `Scan Data` | shipments, invoices, depletions, point-of-sale, inventory, production, purchase, GL and trade-promotion extracts |
| Scenario control | `Scenario`, `Cases`, `Assumptions`, `Drivers`, `RGM`, `Management Overlay` | base/upside/downside, price, promotion, elasticity, commodity, FX, volume and productivity assumptions |
| Demand baseline | `Baseline`, `Base Demand`, `Demand`, `Forecast`, `Stat Forecast`, `Consensus Demand` | unconstrained demand by SKU/channel/customer/location before promotion, innovation or capacity constraints |
| Promotions | `Promo`, `TPM`, `TPO`, `Events`, `Trade Plan`, `Promotion Calendar`, `Uplift` | event dates, mechanics, depth, lift, cannibalisation, forward-buy, post-event dip, funding and customer commitments |
| Revenue growth management | `RGM`, `NRM`, `Price Pack`, `PPA`, `Price Mix`, `PVM`, `Revenue Bridge` | list price, realised price, pack-price architecture, channel mix, premiumisation, assortment and elasticity |
| Volume | `Volume`, `Cases`, `HL`, `Litres`, `Depletions`, `Shipments`, `Units` | volume by brand/SKU/pack/channel/customer/geography, base/promo/innovation components and unit conversions |
| Distribution | `Distribution`, `WD`, `ND`, `ACV`, `Listings`, `Doors`, `Stores`, `Reach` | numeric/weighted distribution, points of distribution, listings, shelf presence, outlet count and velocity |
| Gross-to-net | `GTN`, `Gross to Net`, `Trade Spend`, `Deductions`, `Rebates`, `Discounts`, `Contra Revenue` | off-invoice discounts, rebates, listing/shelf/display fees, customer funding, returns, settlement and accruals |
| Net revenue | `Sales`, `Revenue`, `NSV`, `NNS`, `Turnover`, `Net Sales` | gross invoice sales, excise/sales taxes where applicable, gross-to-net deductions and net revenue |
| Excise and product taxes | `Excise`, `Alcohol Tax`, `WET`, `Sugar Tax`, `Container Levy`, `Duties` | taxable litres/LAL, rates by product and jurisdiction, exemptions, refunds and timing |
| Demand and supply reconciliation | `S&OP`, `IBP`, `Consensus`, `Demand Supply`, `Constrained Plan` | demand, constrained supply, allocation, lost sales, inventory targets and executive overrides |
| Production plan | `Production`, `Supply`, `MPS`, `Plant Plan`, `Brew Plan`, `Bottling Plan`, `Packing` | batches/runs, plant/line allocation, rates, shifts, changeovers, downtime, yield, scrap and co-packing |
| Capacity | `Capacity`, `OEE`, `Lines`, `Plant`, `Constraints`, `Utilisation` | nameplate/design capacity, available hours, OEE components, maintenance, changeovers and bottlenecks |
| Bill of materials / recipe | `BOM`, `Recipe`, `Formula`, `Ingredients`, `Liquid`, `Blend`, `Pack BOM` | raw/pack inputs per output unit, recipe versions, potency/strength, losses, substitutions and standard yields |
| Procurement | `Purchasing`, `Procurement`, `PO`, `Suppliers`, `Contracts`, `Coverage` | purchase quantities, MOQ, lead times, incoterms, contract prices, indexed pricing and supplier capacity |
| Commodities | `Commodities`, `Inputs`, `Raw Mat`, `Packaging`, `Inflation`, `Cost Curves` | sugar, grain, malt, aluminium, PET/resin, glass, dairy, cocoa, coffee, oils, energy and freight assumptions |
| Hedges | `Hedges`, `Derivatives`, `Commodity Hedge`, `FX Hedge`, `Treasury Coverage` | instrument, commodity/currency, volume, price/rate, maturity, basis, designation and settlement timing |
| Standard cost | `Standard Cost`, `COGS`, `Product Cost`, `Costing`, `COGM` | material, conversion, labour, fixed/variable overhead, co-packer fee, duty and transfer-price components |
| Variances | `PPV`, `Usage Var`, `Yield Var`, `Mix Var`, `Factory Var`, `Absorption` | purchase-price, material usage, yield, labour, overhead, volume and mix variances |
| Inventory | `Inventory`, `Stocks`, `RM`, `WIP`, `FG`, `Ageing`, `Shelf Life`, `Maturation` | raw material, packaging, WIP, finished goods, goods in transit, age/expiry, reserves and safety stock |
| Warehousing and distribution | `Logistics`, `Freight`, `Warehouse`, `DC`, `Transport`, `Route`, `DSD` | cases/pallets/stops/km, fixed fleet/warehouse cost, variable freight, third-party logistics and fuel |
| Returnable packaging | `RGB`, `Kegs`, `Crates`, `Pallets`, `Containers`, `Deposits`, `Returnables` | installed pool, issues, returns, cycle time, loss/breakage, deposits, washing and replacement capex |
| Franchise / bottler system | `Bottlers`, `Concentrate`, `Syrup`, `Royalty`, `Territories`, `System Volume` | concentrate incidence, brand-owner revenue, bottler economics, territory rights and system versus reported volume |
| Route to market | `RTM`, `Channel`, `Distributor`, `Wholesaler`, `DSD`, `E-commerce`, `Foodservice` | route ownership, distributor margins, service costs, assortment, customer/channel economics and working-capital ownership |
| Customer planning | `Customers`, `KAM`, `Joint Business Plan`, `JBP`, `Accounts`, `Terms` | customer volume, terms, rebates, promotional calendar, listings, service level and profitability |
| Marketing and brand investment | `A&P`, `Advertising`, `Brand Spend`, `Marketing`, `Media`, `Activation` | media, production, sponsorship, activation, agency, consumer promotion and brand/category allocation |
| Innovation and renovation | `NPD`, `Innovation`, `Launches`, `Pipeline`, `Renovation`, `Stage Gate` | launch dates, distribution ramp, trial/repeat, cannibalisation, listing fees, obsolete packaging and launch spend |
| Quality, returns and recall | `Quality`, `Returns`, `Claims`, `Recall`, `Waste`, `Obsolescence` | defects, returns, replacement, product withdrawal, destruction, customer/consumer costs and insurance recoveries |
| Working capital | `Working Capital`, `AR`, `AP`, `DIO`, `DSO`, `DPO`, `Cash Conversion` | trade receivables, deductions, inventory categories, payables, accruals, prepayments and supplier finance |
| Capex | `Capex`, `Factories`, `Lines`, `Coolers`, `Vending`, `CWIP`, `PPE` | capacity, replacement, productivity, quality, sustainability, returnables, coolers and IT investment |
| FX and hyperinflation | `FX`, `Currency`, `Translation`, `Constant FX`, `Hyperinflation` | transaction currency, functional/reporting currency, average/closing rates, hedges and constant-currency bridges |
| Tax | `Tax`, `Income Tax`, `VAT GST`, `Indirect Tax`, `Transfer Pricing` | income tax, GST/VAT, customs, excise, withholding, intercompany pricing and tax payments |
| Consolidation | `Consol`, `Entities`, `Segments`, `Elims`, `Intercompany`, `PPA` | entity/segment results, transfers, royalties, management fees, eliminations, NCI and acquisition scope |
| Financial statements | `P&L`, `Income Statement`, `BS`, `Cash Flow`, `Three Statements` | reported and management P&L, balance sheet, cash flow and statement bridges |
| Management performance | `Organic Growth`, `Like for Like`, `Underlying`, `Comparable`, `Constant Currency`, `Bridge` | scope, FX, pricing, volume/mix, one-offs, selling-day and acquisition adjustments |
| Outputs | `Summary`, `Board`, `Dashboard`, `KPI`, `Brand P&L`, `Customer P&L`, `Country P&L` | net sales, volume, revenue/volume, gross margin, EBIT, cash, market share, service and return metrics |
| Checks | `Checks`, `Control`, `Integrity`, `Reconciliation` | volume, conversion, gross-to-net, production, inventory, intercompany and statement checks |

### Required dimensional grain and keys

| Dimension | Typical levels | High-risk mapping breaks |
|---|---|---|
| Product | category → subcategory → brand → sub-brand → SKU/material | discontinued SKU retained; new SKU omitted; brand switches category; duplicate material code |
| Pack | package family → container → size → multipack → case configuration | eaches/cases/litres inconsistent; bonus pack treated as price cut only; case count changes mid-series |
| Geography | group → region → country → sales territory → outlet/route | shipments booked in source country; distributor territory overlaps; acquisition perimeter shifts |
| Channel | home/off-trade → away-from-home/on-trade → subchannel → customer banner | route and margin ownership confused; e-commerce gross sales mixed with net marketplace revenue |
| Customer | group → banner → account → ship-to → outlet | rebates calculated at wrong hierarchy; duplicate customers after master-data migration |
| Route to market | DSD → customer warehouse → distributor → bottler → e-commerce/DTC | sell-in mistaken for consumption; distributor margin and inventory assigned to wrong party |
| Supply | network → plant → line → batch/run → storage location | unconstrained demand treated as production; output assigned to unavailable line; co-packer omitted |
| Material | commodity → ingredient/packaging → purchased material → supplier/contract | old BOM version; substitute material double-counted; hedge mapped to wrong exposure |
| Time | fiscal year → quarter → period/month → week → selling day | 52/53-week, moving holidays, leap year and month/week allocations misaligned |
| Measure | each → pack → case → litre/kg → hectolitre/tonne → currency | additive and non-additive metrics mixed; unit-case definition changes; actual and forecast UOM differ |
| Currency | transaction → functional → management/constant → reporting | pricing and cost translated twice; constant-currency output mixed with reported balance sheet |

### Characteristic operating structures

#### Volume architecture

Common decompositions include:

- base volume + promotional uplift + innovation/renovation + distribution change + event/weather
  effect − cannibalisation − delistings − stock-outs = consumer or customer demand;
- opening distributor/customer inventory + manufacturer sell-in − sell-out/depletions = closing
  channel inventory;
- unconstrained demand − capacity/material/allocation losses = fulfilled shipment volume;
- shipments ± goods-in-transit and cut-off adjustments = invoiced volume; and
- invoiced volume × SKU/pack conversion = litres, hectolitres, kilograms or standard unit cases.

Sell-in, sell-out, depletions, scans, shipments and consumption are not interchangeable. A workbook
may carry several legitimately different volume views; each should have an explicit bridge rather than
one generic `Volume` row.

#### Price, pack and mix architecture

A commercial structure commonly separates prior realised unit revenue, list-price actions by effective
date, price compliance/leakage, promotions, customer/channel/brand/SKU/package/geography mix,
premiumisation, excise/product-tax effects, currency translation, acquisitions/disposals, licences and
selling days.

`Revenue / aggregate volume` is a blended result, not a pure price. PepsiCo explicitly defines
effective net pricing as the combined impact of discrete pricing, sales-incentive activity and mix;
labelling the entire quotient movement `price` risks double counting mix or trade spend
([PepsiCo 2025 Form 10-K](https://www.sec.gov/Archives/edgar/data/77476/000007747626000007/pep-20251227.htm)).

#### Gross-to-net and promotion architecture

The common chain is:

`list price × invoiced units = gross billed sales`

`gross billed sales − off-invoice discounts − rebates − listing/display/shelf fees − returns and
credits − customer/bottler funding classified as contra-revenue = net revenue`.

Promotion economics commonly distinguish baseline units, incremental lift, discount depth, funding
split, customer margin, cannibalisation, forward-buy, post-event dip, incremental production/logistics/
obsolescence cost, and settlement/accrual timing.

PepsiCo describes volume rebates and bottler funding based on annual targets, accrued as products are
delivered and settled after reconciliation; it also distinguishes contra-revenue incentives from
advertising/marketing expense. This is a structural precedent, not a universal percentage benchmark
([PepsiCo 2025 Form 10-K, Total Marketplace Spending](https://www.sec.gov/Archives/edgar/data/77476/000007747626000007/pep-20251227.htm)).

#### Production, cost and inventory architecture

`sales demand + target closing finished goods − opening finished goods = required production`

`required good output ÷ yield + expected scrap/loss = gross production input`

`gross input × current BOM/recipe × purchase or standard price = material cost`

`available hours × demonstrated rate × uptime × performance × quality = good-output capacity`.

Manufacturing cost normally includes raw/pack materials, direct labour, variable conversion, co-packer
fees and fixed production overhead absorbed on normal capacity. Warehousing, delivery and merchandising
may sit below gross profit in some policies, so peer gross margins require classification alignment. AB
InBev includes fixed and variable overhead based on normal capacity in inventory cost and considers
expiry, remaining shelf life and slow-moving indicators in NRV
([AB InBev 2025 Annual Report](https://www.sec.gov/Archives/edgar/data/1668717/000119312526049841/d891969dex992.htm)).

#### Route-to-market architecture

| Route | Revenue/volume point | Costs and balances commonly owned by manufacturer |
|---|---|---|
| Direct-store delivery (DSD) | sale/delivery to retailer or outlet | fleet, route labour, merchandising, stales/returns, depot, retailer receivable |
| Customer warehouse | delivery to retailer distribution centre | primary freight and customer deductions; retailer owns downstream replenishment |
| Distributor/wholesaler | sale to distributor | distributor margin/discount and market-development funding; channel inventory obscures consumption |
| Independent bottler/franchise | concentrate, syrup, royalty or finished-goods sale | bottler funding and franchise economics; system volume differs from reported volume/revenue |
| Foodservice/fountain | concentrate/syrup plus equipment/service arrangement | pouring rights, equipment placement, maintenance, customer funding and prepayments |
| E-commerce/DTC | consumer order or marketplace settlement | fulfilment, fees, returns, delivery subsidy, payment timing and channel conflict |

PepsiCo identifies DSD, customer-warehouse, distributor and e-commerce routes and notes DSD is suited
to frequently restocked, promotion-responsive products. Shipping, handling and merchandising
classification must therefore be aligned before margin comparison
([PepsiCo 2025 Form 10-K, Distribution Network](https://www.sec.gov/Archives/edgar/data/77476/000007747626000007/pep-20251227.htm)).

#### Beverage-specific physical structures

- brewed/produced liquid → process loss → finished liquid → packaged litres → saleable cases/hl;
- concentrate incidence × finished volume → concentrate/syrup demand and cost;
- container size × units/pack × packs/case × cases = physical litres;
- litres × alcohol-by-volume = litres of alcohol for relevant duty structures;
- opening returnable pool + purchases + returns − losses/breakage − disposals = closing pool; and
- shipments − returns ± trade-inventory movement = depletions/consumption, depending on channel.

For CCEP reporting, one standard unit case is approximately 5.678 litres or 24 eight-ounce servings;
that convention is company-specific
([CCEP FY2025 results, note 2](https://ir.cocacolaep.com/news-releases/news-release-details/coca-cola-ep-plc-preliminary-unaudited-results-q4-fy-2025/)).

#### Aged spirits structure

An aged-liquid model commonly contains production vintage/fill date; original litres of pure alcohol;
cask/container count; maturation loss by age/location; legal and brand release constraints; blending
and strength reduction; bulk, maturing, bottled and FG inventories; bottling capacity; liquid
availability by future age statement; and long production-to-sale lags.

### Characteristic dependency chains

| Chain | Expected domain connection |
|---|---|
| Consumer demand to revenue | base demand + promotion + innovation + distribution + seasonality − cannibalisation/stock-out → sell-out/depletions → channel inventory → sell-in/shipments → invoiced units → gross-to-net → net revenue |
| Price/volume/mix | prior unit revenue + price actions + leakage + promotion + pack/channel/SKU/geography mix → realised revenue per physical unit; FX and scope shown separately |
| Promotion | event mechanics → baseline/lift/forward-buy/post-dip → shipments and cannibalisation → customer funding/accrual → incremental margin and working capital |
| Customer terms | eligible sales/volume and tier thresholds → rebate/accrual → deduction/settlement → receivable and cash |
| Production | demand + inventory target → constrained supply by plant/line → batches/changeovers → good output, scrap and lost sales |
| Materials | good output ÷ yield × BOM/recipe → purchases/consumption → RM/pack inventory, payable and cost |
| Commodity/FX | purchase exposure by commodity/currency/month → contract/hedge coverage → landed price/settlement → inventory cost → COGS when sold |
| Inventory | opening RM/WIP/FG + purchases/production/transfers − consumption/sales/write-offs → closing quantity × valid cost; age/shelf life/NRV overlays |
| Distribution | cases/pallets/stops/distance by route → fleet/3PL/fuel/warehouse/merchandising cost → customer/channel contribution |
| Returnables | issues, cycle time and return rate → available pool, deposits, losses and replacement capex → cash and cost |
| Brand investment | activity calendar → commitments/accrual/prepayment → expense timing → brand P&L and cash |
| Innovation | launch date → distribution ramp × velocity → trial/repeat and cannibalisation → sales/margin; launch spend, listing fees and obsolete predecessor pack |
| Recall/quality | affected lots/SKUs/markets → stopped sales + returns/replacement/destruction + customer costs → inventory reserve, provisions, cash and recovery |
| Capex/benefits | line, warehouse, cooler, returnable or productivity capex → commissioning and capacity/cost benefit → depreciation, working capital and cash |
| Organic/comparable growth | reported movement − FX − scope/M&A − selling-day/calendar − defined exceptional items → comparable base; price/volume/mix uses same perimeter |
| Cash | EBITDA/operating profit → non-cash and working-capital movements → tax/interest → capex → FCF under the exact stated definition |

## Domain-specific benchmark ranges and reasonableness bounds

### 2025 peer diagnostic panel

The observations below are diagnostic comparators, not pass/fail thresholds. They are 2025 reported
or company-defined measures available by 13 September 2026. Definitions, routes, product mix,
geography, accounting classification and acquisition scope differ. An assumption outside a band may
be sound; it requires a company-specific basis and a definition-aligned bridge.

| Metric and narrow comparator set | Observed 2025 range / points | Interpretation boundary and source |
|---|---|---|
| Global brewer organic volume | **−2.3% to −0.6%**: AB InBev −2.3%; Carlsberg excluding lost San Miguel licence −0.6% | Positive revenue can coexist with falling physical volume. [AB InBev FY2025](https://www.sec.gov/Archives/edgar/data/1668717/000119312526049841/d891969dex992.htm); [Carlsberg FY2025](https://www.carlsberggroup.com/newsroom/fy-2025-financial-statement/) |
| Global brewer revenue per hectolitre | **+1.4% to +4.4%**: Carlsberg +1.4%; AB InBev +4.4% | The quotient includes price, mix, premiumisation and revenue-management effects; it is not a pure list-price assumption. Same sources. |
| Global brewer organic revenue | **−0.6% to +2.0%**: Carlsberg −0.6% (+1.1% excluding San Miguel); AB InBev +2.0% | Licence loss and portfolio scope can dominate the bridge. Same sources. |
| Branded consumer-goods organic/underlying sales growth | **3.2% to 3.5%**: Nestlé 3.2%; Unilever 3.5% | Both separately identify price and real volume, but definitions differ. [Nestlé FY2025](https://www.nestle.com/media/pressreleases/allpressreleases/full-year-results-2025); [Unilever FY2025](https://www.unilever.com/investors/results-events/results-events-webcasts/overview-q4-2025/) |
| Branded consumer-goods real/underlying volume growth | **0.8% to 1.5%**: Nestlé RIG 0.8%; Unilever UVG 1.5% | RIG and UVG are company-defined and are not necessarily shipments. Same sources. |
| Branded consumer-goods pricing contribution | **2.0% to 2.5%**: Unilever 2.0%; Nestlé 2.5% | Additive bridges can differ from multiplicative price-volume maths and residual mix. Same sources. |
| Underlying operating margin, diversified brand owners | **16.1% to 20.0%**: Nestlé UTOP 16.1%; Unilever underlying operating margin 20.0% | Not comparable to brewer normalized EBITDA or bottler operating margin. Same sources. |
| Beverage/foods producer operating margin | **12.2%** PepsiCo reported operating margin | Recall, impairment, acquisitions and comparability items can make reported/core results diverge. [PepsiCo 2025 Form 10-K](https://www.sec.gov/Archives/edgar/data/77476/000007747626000007/pep-20251227.htm) |
| Beverage bottler comparable operating margin | **approximately 13.4%** CCEP (€2.808bn comparable operating profit / €20.9bn reported revenue) | Approximation mixes disclosed measures; align the denominator before formal comparison. [CCEP FY2025](https://ir.cocacolaep.com/news-releases/news-release-details/coca-cola-ep-plc-preliminary-unaudited-results-q4-fy-2025/) |
| Capital-spending intensity, integrated producers/bottler | **about 4.6%–4.7% of revenue**: CCEP PP&E plus software €950m / €20.9bn; PepsiCo $4.415bn / $93.925bn | Arithmetic observations, not targets. Concentrate/brand-owner models may be lighter. Same CCEP and PepsiCo sources. |
| Trade-receivable terms disclosed by two producers | **about 30–90 days**: AB InBev generally within 30 days; PepsiCo typically within 30 days US and 30–90 internationally | Narrow observed range, not a sector rule. Contract, route, country, deductions and overdue profile control. Same AB InBev and PepsiCo reports. |
| Large-customer concentration example | **14% of consolidated net revenue**: PepsiCo sales to Walmart and affiliates | Diagnostic point, not an acceptable maximum. Comparable concentration needs account-level terms and loss/delist economics. [PepsiCo 2025 Form 10-K](https://www.sec.gov/Archives/edgar/data/77476/000007747626000007/pep-20251227.htm) |
| Brand/marketing investment examples | **16.1% of turnover** Unilever; **about 12.5% of revenue** AB InBev ($7.4bn / $59.3bn) | Definitions differ; use to challenge growth alongside unsupported support cuts, not to impose a flat percentage. Unilever and AB InBev sources above. |

### Physical and mathematical bounds

| Area | Genuine bound or identity | Domain application |
|---|---|---|
| Hectolitres | **1 hl = 100 litres** | Do not confuse litres, hl and `000 hl` or produced, packaged and sold liquid. |
| Alcohol volume | **Litres of alcohol = beverage litres × ABV as a decimal** | Duty/excise, production yield and liquid availability; rate rules are product-, date- and jurisdiction-specific. |
| CCEP unit case | **Approximately 5.678 litres or 24 eight-ounce servings** | CCEP-comparable metrics only; another company may define a standard case differently. [CCEP FY2025 note 2](https://ir.cocacolaep.com/news-releases/news-release-details/coca-cola-ep-plc-preliminary-unaudited-results-q4-fy-2025/) |
| Pack conversion | **Container volume × containers/pack × packs/case × cases = physical volume** | Every factor must be positive and time-phased when configuration changes. |
| Channel stock | **Opening trade inventory + sell-in − sell-out − write-offs/other losses = closing trade inventory** | All terms use the same SKU, location, period and UOM. |
| Production conservation | **Input = good output + recoverable by-product + scrap/process loss + closing WIP − opening WIP** | Use a consistent moisture, concentration, strength and packaging basis. |
| Capacity | **Constrained output ≤ available good-output capacity** | Capacity is after planned downtime, changeovers, speed/performance and quality loss. |
| Distribution percentages | Numeric and weighted distribution normally lie between **0% and 100%** for one universe | Points of distribution may exceed 100 and must not be confused with distribution percentage. |
| Market share | Value/volume share lies between **0% and 100%** for a defined category, market and period | Mutually exclusive exhaustive shares reconcile; partial portfolios need not sum to 100%. |
| Promotion lift | Incremental lift may be negative, but **promoted volume = baseline + lift** cannot be negative | Forward-buy, post-event dip and cannibalisation belong in explicit periods/SKUs. |
| Rebate tiers | Payout follows the **contractual retroactive or incremental tier basis** | The two methods produce different cliffs and accruals. |
| Inventory measurement | Carrying value is the **lower of cost and NRV**; reversal cannot exceed original write-down | Includes expiry, slow-moving, recall, completion and selling-cost effects. [AASB 102/IAS 2](https://standards.aasb.gov.au/aasb-102-mar-2020) |
| Fixed-overhead absorption | Allocate fixed production overhead using **normal capacity** | Low production must not capitalise unallocated fixed overhead into stock. Same AASB 102 source. |
| Gross-to-net | Net revenue cannot exceed gross billed sales without a separately identified positive adjustment | Use the same product/customer/tax/currency perimeter. |
| Trade accrual | **Opening accrual + recognised contra-revenue/expense − claims/settlements ± valid reclassification = closing accrual** | Apply by material programme/customer; contractual true-up remains necessary. |
| Returnable pool | **Opening pool + additions + returns/acquisitions − issues/disposals/losses = closing pool** | Deposits, pool losses and replacement capex must coexist. |
| Shelf life | **Remaining life = expiry/best-before date − reporting or expected-sale date** | Negative life indicates expired stock unless another valid convention applies. |
| Working-capital days | DSO uses credit revenue; inventory days use relevant cost/consumption; DPO uses credit purchases/eligible cost | Balance and flow need matching scope, tax and annualisation; no universal days target exists. |
| Organic/comparable bridge | Reported movement reconciles to the defined scope, currency, calendar and adjustments | Company definitions cannot be mixed across years or peers. |
| Free cash flow | Each FCF result reconciles to its stated definition | PepsiCo includes PP&E proceeds; CCEP's comparable measure addresses interest and comparability items. Same company sources. |

### Contractual, statutory and policy bounds

These become genuine bounds only when the model identifies the relevant agreement, jurisdiction,
effective date or approved policy:

- franchise territory, concentrate incidence, royalties and bottler funding;
- customer listing dates, display obligations, volume-rebate tiers and settlement windows;
- payment terms, deductions, minimum orders, lead times and supplier capacity;
- recipe, ABV, fill-volume, label, food-safety and specification tolerances;
- excise, customs, sugar/health levy, WET, GST/VAT and container-deposit rates;
- returnable-package deposits, loss allowances, ownership and cycle time;
- validated plant/line rates, maintenance, batch size and quality-release time;
- shelf life and minimum remaining life accepted by each customer/channel;
- hedge volume, tenor, basis, designation and highly-probable exposure;
- brand investment, launch gates, delisting and capex commissioning dates; and
- transfer prices, royalties, licences and legal-entity ownership.

## Common failure patterns specific to this domain

### Product, customer and unit master data

- **Orphan SKU:** volume exists but price, BOM, trade terms, plant, tax, shelf life or FX mapping is missing.
- **Duplicate SKU:** old and new material codes both forecast the same product after migration.
- **Inactive product revival:** copied growth formulas restart a discontinued SKU after its delist date.
- **Innovation without predecessor exit:** new SKU is added without cannibalising or retiring its predecessor.
- **Wrong hierarchy:** a banner-level rebate is tested at ship-to level, or one brand price covers all packs.
- **Unit mutation:** actuals use eaches, forecast cases and outputs litres, but one period omits conversion.
- **Case-definition drift:** pack configuration changes while historical case conversion is copied forward.
- **Non-additive aggregation:** weighted distribution, market share, unit revenue or margin is summed.
- **Mixed food/beverage volume:** kilograms and litres enter one meaningless group-volume total.
- **Tax-basis mismatch:** actuals are tax-inclusive while price, revenue or receivable drivers are not.

### Demand, sell-in, sell-out and channel inventory

- **Sell-in presented as consumption:** distributor purchases are used as consumer demand without a stock bridge.
- **Pipeline loading:** quarter-end shipments rise and are treated as demand while channel inventory grows.
- **Inventory correction omitted:** destocking is treated as consumer decline, or recovery double counts sell-out and refill.
- **Orders treated as demand:** batching, allocations or scarcity orders inflate forecast; classic bullwhip causes include signal processing, order batching, price variation and shortage gaming ([Lee, Padmanabhan & Whang](https://www2.isye.gatech.edu/~jvandeva/Classes/6203/2006/TheBullWhipEffectinSCsLee.pdf)).
- **Depletions double counted:** distributor sell-out is added to manufacturer shipments.
- **Lost sales disappear:** constrained supply reduces shipments but revenue remains, or unmet demand returns without support.
- **Availability contradiction:** demand rises while distribution/on-shelf availability falls without velocity support.
- **Velocity/distribution double count:** new stores are embedded in velocity and added again as distribution.
- **Aggregate seasonality:** category monthly shape is imposed on SKUs/channels with different event profiles.
- **Selling-day omission:** different selling-day periods are called operational growth; CCEP had 261 days in 2025 versus 262 in 2024.
- **Weather rebased:** a temporary weather variance becomes permanent baseline growth/decline.
- **Stock-out history:** censored sales are used as unconstrained demand without lost-sales correction.

### Promotions and revenue growth management

- **Baseline contamination:** promoted weeks raise the future non-promoted baseline.
- **Wrong grain:** monthly aggregate uplift ignores which SKU, customer, store or week was promoted.
- **Flat elasticity:** one response applies across brand, pack, channel, season and retailer.
- **Forward-buy omitted:** event shipments rise but following-period customer orders do not fall.
- **Post-event dip omitted:** consumption borrows from future demand while future baseline is unchanged.
- **Cannibalisation omitted:** promoted volume is wholly incremental to SKU, pack, brand, channel and period.
- **Halo without basis:** other portfolio sales rise without measured support.
- **Promotion exceeds availability:** uplift exceeds stock, capacity, shelf space or display compliance.
- **Promo ROI uses gross sales:** discount, funding, cannibalisation, COGS, logistics, obsolescence and claims are excluded.
- **Plan/performance mismatch:** accrual uses plan while revenue/production use actual or revised volume.
- **Event interaction ignored:** promotion, media, holiday and competitor events each claim the same uplift.
- **Sparse-SKU false precision:** insufficient history is used to estimate detailed event effects; promotions and short life cycles complicate SKU-store forecasting ([Gür Ali et al., 2009](https://doi.org/10.1016/j.eswa.2009.04.052)).
- **List price equals realised price:** announced increase ignores leakage, promotion, pack and channel mix.
- **Revenue/volume labelled price:** mix and trade spend are counted both in `price` and separately.
- **Premiumisation without migration:** premium growth has no corresponding mainstream/channel change.
- **Elasticity applied twice:** commercial volume already contains price response and a formula reduces it again.
- **Inflation plus discrete price:** both assumptions cover the same price action.

### Gross-to-net, rebates and deductions

- **Trade spend below wrong line:** customer consideration is marketing expense although policy/contract makes it contra-revenue.
- **All marketplace spend netted:** genuine advertising services are incorrectly deducted from revenue.
- **Gross/net price mixed:** volume uses net price and rebates are deducted again.
- **Annual rebate cliff wrong:** retroactive tiers are modelled incrementally, or vice versa.
- **Tier probability frozen:** expected payout does not update as threshold achievement changes.
- **Claims lag absent:** contra-revenue and customer deduction/payment occur in the same month without support.
- **Funding paid twice:** off-invoice discount and subsequent claim represent one programme.
- **Listing/display fee omitted:** distribution growth appears without required customer payment.
- **Upfront right expensed immediately:** multi-period pouring/listing right ignores supported contractual life.
- **Returns reserve flat:** expiry, DSD stales, damage, recall and channel/product age are absent.
- **Deduction double net:** disputed claims reduce revenue and receivables twice.
- **Perimeter mismatch:** gross sales include channels/tax bases that deduction schedules omit.
- **Interim allocation hides true-up:** revised annual incentives do not reallocate consistently.

### Beverage volume, packaging and excise

- **hl/litre thousand-factor:** `000 hl`, hl and litres differ by 1,000 or 100.
- **Nominal fill equals saleable fill:** process, filling, quality and breakage loss are omitted.
- **Pack conversion frozen:** size/count changes but litres and price/litre use the old pack.
- **Foreign unit case:** one company's standard case is imposed on another's metrics.
- **ABV mis-scaled:** 5% is entered as `5` rather than `0.05`, or bases differ across production/excise.
- **Excise on wrong quantity:** duty ignores bonded, returned, exported, destroyed or exempt product.
- **Rate-date error:** latest rate is retrospective or an old rate extends beyond its effective date.
- **Product tax misclassification:** beer, spirits, wine, RTD or alcohol-free product uses the wrong basis.
- **Excise twice:** excise-inclusive price and a separate deduction both include the duty.
- **Levy disconnect:** reformulation changes taxable content but product-tax expense does not.
- **Deposit as revenue:** refundable container amount enters sales without liability/return expectation.
- **Returnable cycle omitted:** immediate full returns create impossible bottle/keg/crate availability.
- **Pool loss omitted:** volumes grow but no loss, deposit change or replacement capex occurs.

### Production, capacity, yield and co-packing

- **Nameplate equals saleable capacity:** maintenance, changeover, speed, quality and mix losses are absent.
- **OEE algebra error:** availability, performance and quality are added, averaged or applied twice.
- **Impossible utilisation:** constrained output exceeds good-output capacity without overtime, capex or co-pack.
- **Wrong bottleneck:** liquid capacity is free while packaging, maturation, cold storage or release constrains sales.
- **Changeovers omitted:** SKU proliferation consumes no line time and creates no start-up scrap.
- **Batch granularity ignored:** production falls below minimum technical/economic batch or order multiple.
- **Yield-basis mismatch:** output and input differ in moisture, concentration, alcohol strength or packaging basis.
- **Yield benefit twice:** improvement both raises output and cuts input beyond the same physical saving.
- **Scrap has no stock/cash effect:** waste reduces output but consumed inputs remain inventory.
- **Fixed-cost over-absorption:** low production capitalises excess overhead rather than using normal capacity.
- **Standard cost equals cash cost:** procurement price differs but PPV, inventory and cash do not bridge.
- **Co-packer economics incomplete:** fee exists but freight, MOQ, materials, yield, capacity and working capital do not.
- **Annual-only capacity:** peak weeks breach line/storage limits despite annual headroom.
- **Instantaneous ramp:** new line reaches full rate, yield and quality on commissioning day.
- **Maintenance capex adds capacity:** replacement output is added without retiring the old line.
- **Benefits precede commissioning:** productivity/capacity appears before installation, validation or qualification.

### BOM, procurement and commodity exposure

- **Obsolete BOM:** forecast consumption remains on the old recipe or pack after effective date.
- **BOM does not conserve:** ingredients, packaging, by-product and process loss do not bridge input to output.
- **Substitution double count:** base and alternative material both supply one production requirement.
- **MOQ/lead-time omission:** purchases exactly equal monthly use despite order multiples and safety stock.
- **Contract ignored:** spot price drives committed/fixed/indexed purchase volumes.
- **Quote-basis mismatch:** commodity grade, unit, location, currency or delivery month differs from exposure.
- **Spot-to-COGS error:** current spot immediately hits COGS despite purchase, inventory and standard-cost lags.
- **Inflation twice:** nominal commodity curve and general input inflation cover the same movement.
- **Overhedge:** physical contract plus derivative volume exceeds highly probable exposure.
- **Basis risk omitted:** instrument and physical exposure differ by grade, location, timing or currency.
- **Maturity mismatch:** hedge settles outside purchase/COGS period without funding or basis effect.
- **Mark-to-market equals cash:** fair-value movement enters unit cash cost before settlement.
- **Accounting/economic hedge conflated:** designation is assumed to prove economic offset or vice versa.
- **Supplier capacity invisible:** allocated purchases exceed contract/capacity; alternative source has no delay/cost.
- **Tariff/customs omitted:** origin, destination, incoterm and rate timing are absent from landed cost.
- **Recovery lag omitted:** full price recovery of commodity/FX shock occurs before customer acceptance.

### Inventory, shelf life, ageing and maturation

- **Inventory days on revenue:** RM/WIP/FG is forecast from sales value rather than physical/cost requirement.
- **One safety-stock rate:** seasonal peaks, lead-time variability, service level and SKU intermittency disappear.
- **Negative stock:** shipment/consumption exceeds available inventory without backorder or lost sale.
- **Ageing not rolled:** value grows but cohorts, expiry and remaining shelf life do not advance.
- **Expired stock sold:** post-expiry quantity earns full revenue and margin.
- **Customer life rule omitted:** technically unexpired product breaches minimum remaining-life requirement.
- **Flat reserve:** delisting, pack redesign, reformulation, decline or launch failure does not change provision.
- **NRV uses list price:** trade deductions, completion, selling, destruction and discount costs are omitted.
- **Aggregate NRV offset:** profitable items shield obsolete/loss-making SKUs at an inappropriate grouping level.
- **Write-off twice:** reserve and disposal both expense the same inventory.
- **Goods in transit omitted/doubled:** title, stock, payable and cash conflict with incoterms.
- **Pipeline fill permanent:** launch/channel build never normalises after steady state.
- **Maturing spirit released early:** sales use liquid before required age or quality date.
- **Angel's share omitted:** maturing litres/LAL do not decline over time.
- **Vintage fungibility:** wrong age, origin, cask or specification fills a brand requirement.
- **Mature liquid equals FG:** bottling, duty, packaging, loss and selling costs are absent from saleability/NRV.

### Route to market, logistics and customer economics

- **Route mix changes only margin:** DSD/warehouse/distributor shift ignores price, stock ownership, terms and service.
- **Distributor margin omitted:** manufacturer revenue is forecast at end-consumer price.
- **Retailer margin inconsistent:** price-pack model and customer P&L allocate different margin pools.
- **DSD fully variable:** fleet, depot and route labour fall immediately with volume.
- **Warehouse treated as DSD:** merchandising, returns and store-delivery costs are duplicated.
- **Pallet/truck conversion frozen:** pack mix changes without freight capacity/cost response.
- **Fuel/backhaul twice:** contract price already includes the surcharge or credit.
- **Free service improvement:** OTIF rises without inventory, flexibility, capacity or logistics cost.
- **Customer P&L before deductions:** rebates, claims, returns, freight and equipment support are excluded.
- **Concentration diluted:** major banner is split across entities/ship-tos and not recombined.
- **Delisting has no inventory effect:** revenue vanishes but FG, packaging, funding and disposal do not.
- **Channel conflict omitted:** DTC/e-commerce is wholly incremental and marketplace/fulfilment cost-free.
- **Territory overlap:** two exclusive bottlers/distributors receive the same geography and volume.
- **Route working capital on wrong owner:** distributor stock/receivable is consolidated into manufacturer cash.

### Marketing, brand support and innovation

- **Growth without support:** premium/share growth accompanies major brand-spend cut without evidence.
- **Flat percentage spend:** committed media, sponsorship, launch and production costs fall instantly with sales.
- **Reclassification saving:** working/non-working spend is relabelled rather than removed or made effective.
- **Prepayment mismatch:** cash and expense ignore the period in which media/sponsorship rights are received.
- **Internal brand capitalised:** routine brand development is treated as an asset without recognition basis.
- **Mature launch velocity:** no distribution, trial, repeat, awareness or service ramp.
- **Innovation gross addition:** no cannibalisation, failure rate, delisting or competitor response.
- **Launch infrastructure omitted:** pipeline stock, listing fee, display, obsolete pack and working capital are absent.
- **Renovation resets comparison:** rebranded/reformulated SKU appears entirely new and loses comparable history.
- **Revenue-only allocation:** launch/strategic spend is spread across established brands and distorts P&Ls.
- **Unsupported share gain:** category, relative price, availability and competitive response do not support it.
- **Benefit without lag:** brand investment creates full sales in the spend period with no response curve.

### Working capital and cash conversion

- **Receivable basis mismatch:** DSO uses net revenue while terms apply to gross invoices or vice versa.
- **Deductions omitted:** customer pays the invoice in full despite material claims/rebates.
- **Accrual without settlement:** gross-to-net expense has no receivable/payable/cash consequence.
- **One inventory-days assumption:** RM, packaging, WIP, FG, transit and maturing stock share one driver.
- **Payables use COGS:** supplier terms apply to expensed cost rather than purchases, hiding inventory build.
- **Supplier finance as DPO:** financing-like extension has no classification, fee or liquidity consequence.
- **Seasonal cash averaged:** annual ratios miss pre-season production and promotional stock.
- **Premature inventory release:** cash improves before sale, consumption, return or write-off.
- **Portable negative working capital:** terms from one geography/route are imposed on another.
- **FCF label drift:** capex, asset sales, leases, interest or comparability items vary across outputs/peers.
- **Returnables omitted from working capital:** deposits, pool stock and replacement funding are separated falsely.

### FX, commodity recovery and performance measures

- **Transaction/translation double count:** purchase/sale margin and group translation receive one FX effect twice.
- **Rate convention mismatch:** flow and closing balance rates do not create a translation-reserve bridge.
- **Constant-currency wrong base:** budget/current rates replace the stated prior-period convention.
- **Hyperinflation definition mismatch:** management organic-growth cap or convention is omitted.
- **Scope bridge incomplete:** acquisition, disposal, licence or territory change enters organic performance.
- **Selling days inconsistent:** calendar adjustment reaches volume but not revenue/cost.
- **Hedge plus price recovery:** full pricing offsets gross input inflation while hedges already offset cost.
- **Immediate local recovery:** retailer, contract and consumer lag are absent after devaluation/input shock.
- **Recurring one-off:** annual restructuring, integration, recall or impairment is always removed as exceptional.
- **Price/mix residual unexplained:** arithmetic residual is labelled mix despite FX, scope, tax or GTN leakage.

### Consolidation, bottlers and sub-archetype mix

- **System volume equals reported volume:** independent bottler sales are consolidated as group shipments/revenue.
- **Concentrate and FG twice:** brand owner and controlled bottler record the same system sale without elimination.
- **Incidence mismatch:** bottler volume grows but concentrate/royalty revenue uses another territory/unit base.
- **Phantom transfer margin:** manufacturing and selling entities both retain profit after consolidation.
- **Intercompany inventory profit:** margin remains in unsold group stock.
- **Apples-to-oranges margin:** concentrate and finished-goods operations are compared without mix bridge; PepsiCo notes finished-goods bottling has higher revenue but lower margins than concentrate sales.
- **Pro forma equals actual:** pre-acquisition results are presented as reported rather than comparability-only.
- **Synergy before control:** savings/revenue precede close, integration action or implementation cost.
- **Licence loss removes fixed cost:** stranded brewery, route, brand and overhead cost disappears with volume.
- **Divested brand keeps shared capacity:** production/overhead benefits persist without transition agreement.
- **Royalty one-sided:** licensor revenue and licensee cost do not eliminate or use the same sales base.

### Quality, returns, recall and regulation

- **Recall population incomplete:** affected batch/SKU/market is disconnected from shipments and channel stock.
- **Inventory-only recall:** returns, replacement, logistics, destruction, lost sales and remediation are omitted.
- **Automatic insurance:** recovery is netted before coverage, acceptance and collectibility support.
- **Replacement as new sale:** replacement earns revenue after original sale is reversed.
- **Stales ignored:** DSD removes out-of-date product but no reserve/cost exists; PepsiCo explicitly reserves for anticipated damaged and out-of-date product.
- **Quality release omitted:** production becomes saleable immediately despite quarantine/testing.
- **Reformulation only capex:** recipe, tax, demand, obsolete pack and production transition are absent.
- **Packaging obligation outside cash:** EPR, recycling or deposit cost is absent where applicable.
- **Water/input constraint cosmetic:** risk changes but capacity, cost, stock or capex does not.
- **Regulatory effective date wrong:** label, ingredient, tax or packaging requirement changes every period at once.

### FMCG/beverage performance and output contradictions

- **Gross-margin classification drift:** manufacturing, freight, warehousing, merchandising or trade spend moves above/below gross profit.
- **Revenue bridge ≠ P&L:** price/volume/mix, FX and scope do not equal net-sales movement.
- **Volume bridge ≠ physical sales:** third-party, licensed, bottler or acquired volume changes perimeter silently.
- **Unit-revenue denominator wrong:** revenue includes excise, food or third-party items absent from volume.
- **Brand/customer P&Ls ≠ group:** allocated production, logistics, marketing and central costs do not reconcile.
- **Inventory-build margin:** overhead deferred in unsold stock is presented as productivity.
- **Saving without driver:** productivity exceeds headcount, yield, procurement, network or line actions.
- **Permanent add-back:** restructuring, integration, recall, impairment or tax items repeat indefinitely.
- **Recurring capex excluded:** route, returnable, cooler, software or replacement investment is omitted from FCF.
- **Organic definition drift:** hyperinflation, scope, calendar, licence or comparability rules change by period.
- **Share contradiction:** model loses volume/share while dashboard claims share gain, or vice versa.
- **Portfolio economics absent:** shift between concentrate/FG, premium/mainstream, DSD/warehouse or returnable/one-way packaging changes no capital or cost.
- **Physical and financial horizons differ:** volume/SKU detail ends before statements, and later revenue is a growth plug.
- **Summary recomputes economics:** dashboard derives its own net sales, volume, margin or FCF definition.

These patterns are domain leads for applying the universal Tier 2 checks. They do not create a second
status system, review method or reporting format.
