# Mining — Domain-Specific Financial Model Review Skill

This file contains **mining-domain knowledge only**: the technical, operational,
mineral-economic, valuation, fiscal and mining-capital relationships that a mining
professional should understand when reviewing a financial model. Generic spreadsheet
review, audit evidence, severity, reporting, governance, formula-engineering, legal
document review and generic financing mechanics belong to the core audit infrastructure
and are intentionally not repeated here. Mining finance is included only where the
finite-resource, mine-development or product-sale characteristics change the economic
interpretation of the model.

## Model type

Apply to mining and mineral-project models across the project lifecycle, including
exploration and resource-conversion cases, PEA/scoping studies, pre-feasibility and
feasibility studies, construction, operating mines, expansions, closure and mineral-
property valuation and finance/fundability cases. Conditional modules below cover
mining capital, placer, in-situ recovery (ISR) and deep-sea/polymetallic-nodule projects.

## Project characteristics

Mining projects are finite-resource businesses whose economics are driven by a
physical chain from geological inventory through mine design, processing, product
specification and sale. The relevant commodity, mining method, recovery route,
product form, jurisdiction, currencies, infrastructure and study maturity must be
identified from project evidence rather than assumed from a generic template.

## Cut-off grade, material routing and mine-economics logic

Cut-off grade is not merely a static minimum grade input. In a mining model it is an economic routing decision that determines which material is mined, processed, stockpiled, routed to an alternative process, or treated as waste. It affects reserve tonnage, average feed grade, mine life, production rate, processing utilisation, cash flow and project NPV.

### Grade–tonnage relationship

Where a reserve/resource or mine-planning schedule exposes grade–tonnage information, the model should preserve the fundamental relationship between cut-off grade, tonnes and average grade:

- increasing cut-off grade will normally reduce tonnes classified for processing and increase average grade above cut-off;
- decreasing cut-off grade will normally increase tonnes and reduce average grade above cut-off;
- contained saleable product depends on tonnes, grade and recovery, not grade alone;
- if the mining method, selectivity, ore-control method, bench height, stope geometry or equipment size changes, the underlying grade–tonnage relationship may also change and should not automatically be held constant.

Do not treat a movement that violates these directional relationships as an automatic error if the model contains a geological or routing explanation. It is, however, a strong mining-specific challenge point.

### Internal (mill) versus external (mine) cut-off

Distinguish the economic decision being made:

- **Internal / mill cut-off:** material is already committed to be mined. The decision is whether to process it or send it to waste/another destination. Costs that will be incurred regardless of routing should not be charged again to the processing decision.
- **External / mine cut-off:** material can be left in the ground. The decision must cover incremental mining as well as processing and applicable waste-stripping consequences.
- **External cut-off with stripping:** where additional mineralised material requires incremental waste stripping, the economic threshold must reflect the waste movement required to expose it.

A model that uses one universal cut-off formula for all three decisions can materially misclassify ore and waste.

### Multiple processing routes

Where material can be sent to two or more processes — for example mill versus heap leach, flotation versus another recovery route, or direct shipping versus beneficiation — compare the economic value of each route rather than applying one ore/waste threshold to all material.

The routing comparison should consider, as applicable:

- route-specific mining/haulage cost;
- processing cost;
- route-specific recovery;
- product value and payable terms;
- freight, treatment, refining and selling deductions;
- quality penalties or bonuses;
- capacity constraints and opportunity cost.

The correct boundary between routes is where the economic utility/value of the competing destinations is equal.

### Recovery is not always constant

Do not assume processing recovery is independent of head grade, mineralogy or throughput where the model indicates otherwise. Recovery may vary with:

- head grade;
- oxidation state;
- mineralogy;
- clay or sulfide content;
- grind size;
- throughput;
- solution application rate in leach operations;
- stockpile age or oxidation.

If a sensitivity changes cut-off grade or plant throughput materially while recovery is held fixed, check whether that is an explicit supported assumption or an oversimplification.

### Polymetallic deposits and net smelter return

For deposits containing more than one economically valuable metal, a single metal grade may be insufficient to determine routing. Prefer an economic value measure such as **net smelter return (NSR)** where the model supports it.

NSR logic should reflect, by metal/product as applicable:

- head grade;
- metallurgical recovery;
- payable percentage;
- commodity price;
- treatment/refining charges;
- freight and selling costs;
- concentrate ratio;
- penalties for deleterious elements.

Metal-equivalent grades are only defensible when the equivalence formula uses consistent prices, recoveries and selling terms and is transparently disclosed. Because equivalence changes as these inputs change, do not assume a fixed equivalent-grade factor remains valid across scenarios.

### Capacity constraints and opportunity cost

Breakeven or marginal cut-off grades based only on direct operating cost are incomplete when a mine, plant, refinery, transport route or sales channel is capacity constrained. Processing an additional low-value tonne can displace or delay higher-value material already scheduled and thereby destroy NPV.

Mining-model review should identify the binding constraint and ask whether material-routing economics recognise it. Typical constraints include:

- total mine movement;
- shaft/haulage capacity;
- plant throughput;
- grinding or leach capacity;
- refining/smelter capacity;
- tailings or environmental permit limits;
- contracted sales volume;
- logistics/export capacity.

Opportunity cost normally declines as the remaining value and life of the operation decline. Therefore an economically optimised cut-off profile may decline over the mine life rather than remain flat.

Do not require a declining cut-off mechanically. Geological changes, price changes, operating changes, quality constraints or revised mine plans can justify another profile. The key test is whether the cut-off strategy is coherent with the actual binding constraints and economic objective.

### Mine and plant capacity interaction

When mining capacity changes while plant capacity is fixed, the model should consider the resulting change in cut-off, head grade, waste movement, stockpile generation and mine life. When plant capacity changes while mining capacity is fixed, the model should consider the lower-grade material required to fill the additional plant capacity, changes in recovery/unit cost and incremental capital.

A capacity expansion is not justified merely because annual production increases. The model should compare the discounted incremental benefit with incremental capital and operating cost and consider changes in mine life, stockpiling and recovery.

### Joint scale–cut-off optimisation and economic envelope

Production scale and cut-off grade are not independent design choices. A larger mining or processing
rate can require a lower cut-off to provide sufficient feed, which can reduce average head grade, alter
recovery, increase total material movement, change stockpile strategy, shorten or extend mine life, and
change the capital and construction programme. Conversely, a higher cut-off can reduce tonnes while
raising average grade and changing the scale that the deposit can economically support.

Where mine scale is a material value driver, do not accept a single inherited production rate and a
separately selected cut-off as evidence of optimisation. Review whether the study has considered a
coherent range of **production-scale × cut-off** combinations and the resulting NPV or other stated
value metric. A useful representation is an NPV surface or “Hill of Value”, but the skill does not
require that specific model or terminology. The purpose is to demonstrate that the chosen mine size
is not simply the largest plant, the longest mine life, the historic operating rate, or the first case that
passes a corporate hurdle.

The economically strongest solution may not be technically, permitting-wise or financially feasible.
Where that occurs, compare the economically attractive envelope with the feasible design and identify
the constraint that causes value to be surrendered — for example geotechnical limits, shaft/haulage,
plant technology, water, power, tailings, logistics, market capacity, permitting, capital availability or
construction risk. This reduces path-dependence and makes the cost of design constraints visible.

A material change in long-term price, discount rate, cost structure, recovery or other economic driver
can shift the preferred cut-off and production scale. If a scenario freezes both after a large economic
change, treat it as a first-order sensitivity unless the fixed design is intentionally being tested.

### Scale, capital intensity and construction duration

Scale changes should not be modelled by multiplying annual production while leaving capital intensity,
construction duration and ramp-up unchanged. Larger operations may benefit from lower installed
capital per unit of capacity, but require greater absolute capital, longer engineering/construction periods,
more infrastructure and a larger commissioning challenge. Smaller operations may have higher unit
capital intensity but lower absolute funding requirements and shorter time to first cash flow.

Use project-specific engineering evidence or supportable scaling relationships. Do not impose a
universal economies-of-scale curve. The mining-domain test is whether capex, schedule, infrastructure
and ramp-up move coherently with the scale being evaluated.

### Non-linear mine cost response and diseconomies of scale

Mine costs should not be assumed to decline indefinitely as tonnes increase. Spreading fixed costs can
lower unit cost over part of the production range, while variable and marginal costs can rise when the
operation encounters diminishing returns or new constraints. Mining examples include longer haul
distances, deeper mining, congestion, additional development, ventilation, dewatering, maintenance,
labour productivity, dilution, lower feed grade, lower recovery, energy intensity, tailings capacity and
water constraints.

When material scale alternatives are being compared, challenge a model that applies one linear unit
cost across all rates without evidence. Cost-versus-output relationships can be supported by engineering
estimates, operating history, fleet studies, contractor schedules or empirical analysis. The precise
functional form is not prescribed.

The fixed/variable split is also decision- and time-horizon-dependent. A cost that is fixed for a monthly
operating decision can become variable during a redesign or expansion. Outsourcing owner mining,
processing or equipment may convert fixed commitments into unit-rate or minimum-volume charges; it
does not automatically reduce the underlying economic cost.

### Throughput–recovery–cost trade-off

Some processing plants can increase throughput by changing operating conditions such as grind size, but with lower recovery and different unit cost. Where the model includes such an operating relationship, throughput, recovery and processing cost should move together. A throughput sensitivity that changes tonnes only, while leaving known recovery and cost relationships unchanged, is incomplete.

### Stockpiles are an economic destination

Low-grade stockpile material should not be treated as either free inventory or identical to fresh ore. Stockpile economics can include:

- initial stockpiling cost;
- stockpile preparation/expansion cost;
- environmental and maintenance cost;
- future rehandling cost;
- future processing cost;
- delayed revenue and discounting;
- recovery changes during storage;
- oxidation/weathering effects;
- future price assumptions;
- opportunity to extend mine/plant life.

Where lower-grade material is generated because a capacity constraint favours processing higher-grade ore first, the model should explicitly show whether the lower-grade tonnes are wasted, stockpiled or processed later.

### Mine planning and selectivity

Mine plans and cut-off assumptions must be consistent with the mining method and expected selectivity.

For open pit models, relevant economic units may include pit stages/pushbacks and incremental stripping. For underground models, relevant units may include stopes, development access, dilution, backfill and haulage constraints. For block/panel caving, the model must recognise the limited ability to selectively stop drawing isolated low-grade material without affecting adjacent drawpoints.

A deposit model suitable for a selective underground method should not be assumed to produce the same grade–tonnage relationship as a bulk open-pit or caving method. When mining method, bench height, stope size, equipment size or ore-control practice changes, challenge whether the resource/reserve and production model should also change.

### Cost basis for cut-off decisions

The appropriate cost base depends on the decision date and decision type:

- sunk historical capital does not normally belong in an operating-period marginal routing decision;
- during feasibility/design, initial capital, sustaining capital, operating cost, capacity and cut-off are interdependent and should be optimised together;
- future sustaining capital required to continue processing should be reflected in the economics of the material that relies on that investment;
- where the time between mining, processing and sale is material, costs and revenues should reflect the required rate of return / discounting;
- environmental, closure, permitting and socioeconomic consequences may alter the preferred strategy even where a simple NPV-only calculation suggests otherwise.

### Blending and product-quality constraints

In coal, iron ore and many metal operations, material can be economically valuable because of how it blends with other material rather than because it independently meets a cut-off.

Where blending is material, test that the model respects:

- tonnage availability by stockpile, seam, pit, source or mine;
- weighted-average grade/quality calculations;
- minimum and maximum product specifications;
- deleterious-element limits;
- contractual product-quality requirements;
- recovery/processing implications of the blend;
- objective of the blend — e.g. maximise saleable tonnage, metal content, grade, margin or NPV.

For ratios such as silica-to-magnesia, do **not** calculate the blended ratio as the weighted average of the source ratios. Blend the underlying numerator and denominator quantities first, then calculate the ratio from the blended quantities.

Coal-specific blending can require simultaneous control of calorific value, ash, sulfur, moisture and product split. Iron-ore blending can require control of Fe together with silica, alumina, phosphorus and other penalties/specifications.

## Mining project economic evaluation

A mining model should connect the physical mine plan to an economic cash-flow model on a consistent basis. The mining-specific question is not merely whether NPV or IRR is calculated correctly, but whether the cash flows represent the actual rights, development expenditure, production, royalties, working capital, tax attributes, currency exposures and end-of-mine obligations created by the mine plan.

### Life-of-mine cash-flow structure

Where relevant to the project stage and jurisdiction, distinguish the principal mining cash-flow categories rather than collapsing them into one generic capex/opex stream:

- mineral rights, tenement or resource-acquisition expenditure;
- exploration, evaluation and mine-development expenditure;
- pre-stripping, shafts, declines and access development;
- mining fleet, plant, infrastructure and other tangible capital;
- sustaining and replacement capital required to continue production;
- production-linked revenue by commodity/product;
- royalties and other resource-linked levies;
- mining, processing, logistics, site and corporate operating costs;
- operating working capital, including product/in-process inventory and receivables where material;
- tax deductions, tax losses and resource-specific tax attributes where applicable;
- closure, rehabilitation, residual asset value and release/recovery of working capital.

The exact accounting and tax treatment varies by jurisdiction. The domain test is whether the model distinguishes economically different categories when that distinction affects after-tax cash flow, reserve economics or terminal value.

### Real versus nominal mining economics

Long-life mine models often combine a commodity-price deck, local operating costs, capital costs and closure estimates prepared on different price bases. Confirm that the model has a coherent real/nominal convention:

- a real commodity-price deck should not be combined with selectively inflated costs and a nominal discount rate without a documented conversion;
- nominal cash flows should include the intended escalation/inflation assumptions consistently across relevant revenue, opex, capex, royalties and closure items;
- real cash flows should be valued with a real discount rate or otherwise converted consistently;
- escalation above or below general inflation should be explicit where the project assumes commodity, labour, energy, explosives, freight or equipment costs move differently.

A model can produce a mathematically correct NPV from internally inconsistent real/nominal assumptions. Treat basis consistency as part of the mining economics, not as a presentation issue.

Where a nominal discount rate is converted to a real rate, use a compounding-consistent relationship such as the Fisher equation rather than assuming that simple subtraction of inflation is exact. The numerical difference may be small in some cases but can become material over a long mine life.

### Multi-currency export exposure

Many mines sell a benchmark commodity in USD or another hard currency while incurring mining costs, taxes and local expenditures in a different operating currency. The model should map the currency of each material stream, including:

- benchmark commodity price and realised sales currency;
- local mining and processing costs;
- imported equipment, reagents and consumables;
- freight, treatment and refining charges;
- royalties and taxes;
- debt principal and interest;
- closure and rehabilitation expenditure.

Do not assume currency depreciation is uniformly good or bad. A weaker local currency may reduce local costs in hard-currency terms while increasing the burden of hard-currency debt or imported inputs. If export revenue is naturally hard-currency linked, test that this hedge actually flows through the model; if revenue is domestic or contract-fixed, do not assume the same protection.

### Mineral-rights basis, depletion and mine-development deductions

Keep **accounting amortisation/depletion** separate from **tax depletion or tax deductions**. A mining-rights/resource asset may be amortised on units of production for financial reporting, while tax law may use a different basis, rate, timing or method.

Where the jurisdiction permits production-based tax depletion or a similar deduction:

- the eligible basis should be identified and supported;
- the deduction should respond to units produced/sold and the relevant reserve base;
- remaining eligible basis should roll forward coherently;
- the model should not apply a depletion allowance to revenue or assets that do not qualify;
- tax depletion should not be double counted with accounting amortisation or another tax deduction.

Historical statutory percentages and U.S.-specific methods described in older mining-economics texts are **not universal current rules**. Use the project's current tax advice, legislation or disclosed tax assumptions for the actual rate and eligibility test.

### Tax-loss usability and stand-alone project economics

Construction and ramp-up commonly create tax losses before the mine generates taxable profit. The economic value of those deductions depends on who can use them and when. Distinguish, where relevant:

- a stand-alone project that carries losses forward until the project itself earns taxable income;
- a consolidated/group taxpayer that may be able to use deductions against other taxable income;
- ring-fenced or resource-specific tax regimes where losses cannot be freely shared;
- expiry, utilisation limits or ownership/continuity constraints if they are material and supported by the tax basis.

Do not give immediate cash value to tax deductions merely because they exist. The cash-tax model should reflect the project's actual assumed tax position.

### Royalties and resource-linked levies

Royalties are not all equivalent. Determine the contractual/statutory base before testing the calculation. Depending on the mine, the base may be:

- gross sales value or gross revenue;
- realised value after specified transport or selling deductions;
- net smelter return/netback;
- tonnes, ounces or other production units;
- margin, profit or net proceeds;
- a sliding scale linked to price, margin or profitability.

Where multiple royalty, production-levy, severance/resource-tax or property-based charges apply, model them separately if their bases or tax treatment differ. A royalty should not simply be set as a flat percentage of whichever revenue row is easiest to reference.

### Working capital, inventories and terminal release

Mining working capital can be driven by more than trade receivables/payables. Depending on the operation, relevant balances may include:

- ROM or run-of-mine inventory;
- concentrate, doré, finished coal or ore inventories;
- consumables, reagents, fuel and critical spares;
- receivables created by shipment/payment terms;
- payables and accrued contractor costs.

Working capital should grow and release with the operating profile rather than remain an arbitrary fixed amount. At the end of mine life, test whether inventory liquidation and working-capital recovery are consistent with the final production/sales schedule and do not double count material already valued as a stockpile or terminal asset.

### Ore-tonne versus metal-unit cost discipline

Mining performance should distinguish the cost of moving/processing ore from the cost of producing
saleable metal or product. These metrics can move in opposite directions. A mine can lower $/t mined
or $/t processed by increasing throughput while simultaneously increasing $/lb, $/oz or $/t of saleable
metal because the additional tonnes carry lower grade, higher dilution, lower recovery or poorer product
quality.

Where production scale, cut-off, grade or recovery changes materially, review both denominators and
reconcile them through contained and recovered metal. Do not treat a falling ore-tonne unit cost as proof
of improved mine economics if metal-unit margin or project value deteriorates.

### Mining sensitivities and break-even tests

Mining economics should be challenged through the physical and commercial drivers that actually create value. Where material, test at least a sensible subset of:

- benchmark and realised commodity price / NSR;
- ore tonnes, grade, dilution and recovery;
- mining rate, processing throughput and ramp-up;
- strip ratio or underground development intensity;
- mining and processing unit costs;
- initial and sustaining capital;
- schedule delay and mine life;
- FX;
- royalties/resource levies;
- closure/rehabilitation cost and timing.

A useful reverse stress asks what realised price/NSR, unit cost, recovery, capex or schedule assumption makes NPV zero, breaches a funding constraint, or otherwise reaches the project's stated economic hurdle. Monte Carlo or probability-weighted analysis can add value where uncertainty is explicitly modelled, but it is not mandatory merely because the project is a mine.

### Exploration and staged-development risk

For exploration, resource-conversion or staged-development models, a positive probability-weighted NPV is not by itself proof that the strategy is financially survivable. Check the relationship between:

- probability of geological/technical success;
- cost of each unsuccessful stage;
- timing of the next capital commitment;
- ability to stop, defer, farm out or joint venture;
- available liquidity and funding before success is known;
- value of preserving development optionality.

Do not apply this framework mechanically to an established producing mine. It is most relevant when the model explicitly contains uncertain exploration or staged-development decisions.


### Value of additional geological, metallurgical and mine-planning information

Mining projects frequently face a decision between committing capital now and spending more
time and money to reduce uncertainty first. Additional information has economic value only if
it could reasonably change a mining decision or materially improve the decision being made.

Where the model or study contemplates further drilling, bulk sampling, metallurgical testwork,
geotechnical work, hydrogeological work, pilot testing or mine-planning studies, consider:

- which uncertain mining variable the work is intended to resolve;
- whether that variable is material to Resource/Reserve classification, cut-off, mine design,
  recovery, throughput, product quality, capital intensity, operating cost, schedule or closure;
- the plausible decisions that could change after the information is obtained — proceed,
  defer, redesign, change process route, reduce/increase capacity, farm out, abandon or acquire
  further data;
- the cost and schedule delay required to obtain the information;
- the downside avoided or upside unlocked if the information changes the decision.

Do not require a formal expected-value-of-information calculation in every model. The mining
discipline is to avoid spending heavily to refine immaterial variables while the project remains
exposed to much larger unresolved geological, metallurgical, market or execution uncertainties.
Conversely, a marginal project should not be rejected solely because current information is
uncertain if targeted additional work could economically resolve the uncertainty before the next
irreversible capital commitment.

### Mine-plan, expansion and development alternatives

When comparing mutually exclusive mine plans, processing routes, plant expansions, development timings or sell-versus-develop alternatives:

- place alternatives on a common valuation date and consistent economic basis;
- include the opportunity cost of assets or mineral rights that could be sold rather than used;
- compare incremental cash flows as well as standalone project economics;
- use a consistent tax and real/nominal basis;
- keep leverage/funding assumptions comparable unless financing is itself part of the alternative;
- do not select an alternative solely because it has the highest standalone IRR if another alternative creates greater value at the required return.

For capital-rationed portfolios of independent exploration or mine projects, the selection problem differs from choosing one mutually exclusive mine plan. Do not use the same ranking logic without considering the capital constraint.

### Closure cash flows and rate-of-return ambiguity

Mine closure and rehabilitation can create a late negative cash flow after years of positive operating cash flow. This can cause more than one mathematical IRR/XIRR root or make a conventional IRR economically misleading. Where the cash-flow series changes sign more than once:

- inspect the sign pattern explicitly;
- use NPV/XNPV at the stated hurdle rate as the primary value cross-check;
- do not hide an IRR failure or non-unique result behind a blank/error-suppression formula;
- if a modified return measure is used, disclose its financing/reinvestment assumptions.

The same end-of-mine cash flows can also affect cut-off strategy: continuing marginal production may be economic if it defers a large closure outflow, but only if the incremental loss is outweighed by the value of deferral and all relevant future costs are included.


### Project value tracking for operating mines and committed developments

Once capital has been committed, the original mining investment thesis should not disappear behind annual
budgets and accounting variances. For a material operating mine, expansion or development project, a useful
domain control is to periodically bridge the original approved value case to the current forecast value.

The bridge should separate, where material, external changes from management/operating changes, such as:

- commodity price, FX and market terms;
- Resource/Reserve, grade, dilution and mine-plan changes;
- throughput, availability and metallurgical recovery;
- operating-cost and productivity changes;
- capex, construction and ramp-up changes;
- royalties/tax changes;
- closure, rehabilitation and terminal assumptions.

This is not a requirement to preserve the original plan. The purpose is to explain **why value changed**,
identify which assumptions or decisions destroyed or created value, and test whether current tactical actions
remain consistent with the economic objective of the mineral asset. A current model that cannot be reconciled
to its material investment-case changes may conceal persistent value leakage.

## Mining study maturity, feasibility and bankability

A mining financial model must be judged against the **development stage of the underlying project**. A concept or scoping model, a pre-feasibility study (PFS), and a feasibility/bankable feasibility study (FS/BFS) can legitimately contain different levels of engineering definition and estimate precision. The model should not imply more certainty than the supporting technical work can provide.

### Economic option generation before design lock-in

A study can be technically detailed and still be economically sub-optimal if it has been anchored too early
to one mining method, plant size, cut-off, process route or infrastructure concept. Before substantial
engineering effort is committed, the project should have considered the economically important alternatives
that the deposit can plausibly support. The objective is not to design impossible mines; it is to avoid allowing
an inherited technical concept to determine the answer before the economic choices have been tested.

For material projects, challenge whether early option work considered, where relevant:

- alternative production scales and cut-off strategies;
- selective versus bulk mining or materially different mine methods;
- alternative processing routes and product forms;
- staged/modular versus full-scale development;
- by-product/co-product recovery alternatives;
- different logistics/infrastructure configurations;
- defer, expand or phased-development choices.

Once a preferred feasible design is selected, the study should be able to explain why economically stronger
alternatives were rejected — technical infeasibility, excessive execution risk, permitting, market constraints,
capital availability or another evidenced modifying factor. Passing the minimum hurdle rate is not itself
evidence that the deposit has been economically well utilised.

### Study-stage expectations

Use the declared study stage to calibrate what evidence should exist:

- **Concept / scoping:** option screening, broad mining and processing concepts, order-of-magnitude costs, preliminary economics and large uncertainty are normal. The model should not present conceptual inputs as finance-ready facts.
- **PFS:** the project should have materially better resource/reserve definition, preliminary mine design and extraction schedule, processing route selection, environmental baseline work, infrastructure concepts, CAPEX/OPEX estimates, financial evaluation and risk/sensitivity analysis. The purpose is to choose a preferred development path and decide whether a full FS is justified.
- **FS / BFS / definitive feasibility:** the financial case should be supported by the final or near-final mine plan and production schedule, detailed geotechnical/hydrological work, metallurgical test work and process design, infrastructure design, equipment requirements, permitting pathway, environmental and social assessment, detailed CAPEX/OPEX, execution schedule, financing requirements and project-risk assessment.
- **Execution / construction:** the financial model should reflect current procurement, construction, commissioning and contingency information rather than relying on an obsolete feasibility basis.

Estimate uncertainty should narrow as engineering and test work mature, but do not impose a universal percentage range by study stage. Use the project's declared estimate class, current competent/qualified-person work, engineering definition and cost-estimating basis to judge whether the stated confidence is supportable.

### Resource, reserve and modifying-factor discipline

A mine model should distinguish mineral **resources** from economically mineable **reserves**. The applicable reporting code and jurisdiction determine the exact terminology, but the economic logic is consistent:

- inferred or similarly low-confidence material should not silently be treated as proven mineable reserve;
- conversion to reserve requires application of relevant modifying factors, which can include mining, metallurgical, geotechnical, hydrological, infrastructure, environmental, legal, social, marketing and economic factors;
- production schedules, mine life and financing cases should identify whether they rely on reserves only, resources beyond reserves, exploration upside or an explicit conversion assumption;
- when a material modifying factor changes, the reserve/mine-plan/economic case should be revisited rather than leaving the financial model unchanged.

Do not make a finding merely because a model includes non-reserve material. Some strategic or valuation cases legitimately include resources or exploration upside. The issue is whether the category, confidence, timing and economic treatment are transparent and appropriate to the stated use of the model.

### Resource database integrity, density and QA/QC

The financial model may begin several layers downstream of the Resource estimate, but a
material Resource/Reserve-driven valuation is only as strong as the mineral inventory it
consumes. Where the review scope or available evidence permits, understand whether the
Resource/Reserve basis is supported by an appropriate database containing the relevant
geological, survey, sampling, assay, geotechnical/geometallurgical and bulk-density data.

Mining-specific challenge points include:

- drill/sample locations and survey data are sufficiently reliable for the stated confidence category;
- sampling, preparation and analytical methods are appropriate to the deposit and commodity;
- QA/QC covers appropriate standards, blanks, field/coarse/pulp duplicates and material deleterious elements;
- historical data are validated before being combined with newer data;
- bulk density accounts for lithology/mineralogy, weathering, porosity/voids and moisture where material;
- density proxies or formulae are checked against measured values where possible;
- primary observed data are distinguished from interpreted geological/mineralisation domains;
- material exclusions, capping/outlier treatment or data transformations are explained.

Do not attempt to re-perform a full geostatistical Resource estimate inside a financial-model
review. The objective is to detect when the economic model is relying on a mineral inventory
whose stated confidence is unsupported by the available technical basis.

### Resource-model spatial support and mining scale

Where the financial case materially depends on a block model or spatial Resource estimate, understand whether the model is supported by the geology and data density at the scale at which mining decisions are being made. Relevant mining-specific considerations include:

- estimation domains should follow material geological/mineralisation controls rather than interpolate indiscriminately across incompatible populations;
- continuity assumptions, search distances and anisotropy should be supportable by the available spatial data;
- block size and estimation support should be coherent with the intended mining selectivity and selective mining unit;
- model validation should compare estimates with informing data and, for operating mines where available, grade-control and production reconciliation;
- a statistically smooth Resource model can still misstate selective-mining economics if it suppresses local grade variability at the scale actually mined.

Do not require the financial-model reviewer to reproduce kriging or geostatistical estimation. The domain task is to identify when the economic model gives precision to tonnes, grade or selectivity that the underlying spatial model and data cannot support.

### Dilution, mining losses, Reserve reference point and reconciliation

Reserve economics must be clear about **where the tonnes and grade are measured**. The
reference point may be in-situ, after mining dilution/loss, ROM, plant feed or a saleable
product point depending on the reporting basis. Do not apply recovery, dilution or loss twice
when moving between those points.

Distinguish:

- planned dilution embedded in mine design from unplanned/operational dilution;
- mining loss/ore loss from metallurgical recovery;
- in-situ grade from diluted mine/feed grade;
- stockpile balances from newly mined ore;
- Resource conversion/reclassification from depletion through mining.

For a model specifically presented as the economic demonstration supporting a Mineral
Reserve, the Reserve case should rely on the applicable economically mineable Reserve
categories rather than silently using Inferred material as Reserve. Strategic/upside cases may
include lower-confidence material if separately identified and not confused with the Reserve
case.

### Production schedule, workforce and equipment feasibility

A Reserve or feasibility production schedule must be physically achievable. Reconcile annual
ore/waste movement, underground development, processing throughput and ramp-up with, as
applicable:

- mine sequence, pushbacks, stopes or development access;
- equipment fleet size, capacity, availability and replacement/rebuild timing;
- workforce/crew requirements and operating calendar;
- haulage/shaft/conveyor constraints;
- plant nameplate and realistic ramp-up/availability;
- waste, tailings and stockpile handling capacity;
- contractor scope and the costs/inputs retained by the owner.

A schedule is not feasible merely because annual tonnes remain below a single headline plant
capacity. Mining, development, materials handling and workforce can each be the binding
constraint.

### Cross-discipline feasibility integration

A bankable mining model is not a stand-alone finance spreadsheet. It is an economic synthesis of the technical study. Reconcile the model to the disciplines that determine mine feasibility, including as applicable:

- geology and resource estimation;
- geotechnical design and slope/stope assumptions;
- hydrology and water management;
- mine design, scheduling, dilution and recovery;
- metallurgy, process design and test work;
- tailings, waste rock and residue management;
- power, water, roads, rail, port and other infrastructure;
- logistics and product transport;
- marketing, offtake, product specifications and payability;
- HSEC / environmental and social requirements;
- permitting, legal rights and land access;
- closure and rehabilitation;
- construction, procurement, commissioning and ramp-up.

The financial model should be consistent with the same physical project described by those workstreams. A mine plan cannot assume one throughput, waste profile, water demand or product specification while the process, infrastructure or environmental studies assume another without an explicit reconciliation.

Material changes to the feasibility design should propagate through the economic case. Examples include a revised pit shell, tailings design, power source, water source, processing route, product form, logistics route or permitting condition.

### Feasibility-to-operating performance reconciliation

For a mine that has entered commissioning or operations, compare the current operating case with the technical assumptions on which the investment or feasibility decision was made. Mining underperformance is often cumulative: several modest misses in grade, throughput, recovery, availability, reagent/energy consumption or mining cost can combine to destroy the original margin.

Where evidence exists, reconcile at least the material drivers:

- mined and plant-feed grade versus the Reserve/feasibility schedule, including dilution and ore loss;
- mine movement, development metres or stripping versus design;
- crusher/mill/plant throughput, utilisation and availability versus design;
- grind or product size and metallurgical recovery versus testwork/design;
- reagent, consumable, fuel, power and water intensity versus feasibility;
- mining, processing, logistics and maintenance unit costs versus the approved basis;
- ramp-up duration, sustaining capital and production timing versus the investment case.

The purpose is not to assume the feasibility estimate was infallible. It is to determine which technical assumptions failed, whether the current forecast has been rebased to observed performance, and whether the remaining Reserve and mine plan are still economic under the demonstrated operating envelope.

## Mining estimate basis, contingency and investment requirement

### Cost-estimate maturity

For material mining CAPEX and OPEX, assess whether the source quality is appropriate to the project stage. Useful evidence can include supplier quotations, contractor rates, engineering quantities, benchmarked unit rates, recent operating data and specialist estimates.

Do **not** convert a particular case-study practice such as obtaining three quotations for every line item into a universal rule. The domain principle is that bankability requires a cost basis commensurate with materiality, design maturity and procurement risk.

Where a model uses benchmark costs from other mines or jurisdictions, check whether it adjusts for material differences such as:

- mine method and scale;
- commodity/product specification;
- location and logistics;
- labour productivity and wage base;
- power, fuel and water costs;
- climate, altitude and remoteness;
- currency and base date;
- local content/import requirements;
- tax and duty treatment;
- technology maturity;
- construction market conditions.

### Contingency and uncertainty allowances

Contingency should represent uncertainty that is not already explicitly included elsewhere. Depending on project practice, uncertainty can be separated into categories such as:

- estimate/quantity uncertainty;
- schedule/delay risk;
- escalation or market-price risk;
- technical/design risk;
- commissioning/ramp-up risk.

Test for **double counting**. A model should not, for example, apply an explicit inflation/escalation curve and then add an undifferentiated escalation contingency for the same exposure unless the distinction is documented. Likewise, a Monte Carlo distribution around CAPEX should not automatically be added on top of a full deterministic contingency that already represents the same risk.

Where contingency is risk-based, the model should preserve the link between the risk drivers and the resulting funding requirement or percentile case. A single unexplained contingency percentage may be reasonable at an early stage but is weaker evidence at BFS stage.

### Forward funding requirement versus sunk costs

Keep the **forward investment requirement** distinct from historical sunk expenditure. Costs already incurred may be relevant to total project history, accounting basis or acquisition analysis, but they are normally excluded from the cash still required to reach first production and from marginal go-forward decisions.

A funding requirement may include, as relevant:

- remaining development CAPEX;
- pre-production operating costs;
- initial working capital;
- owner costs;
- contingency;
- escalation to expenditure date;
- financing fees/reserves if the funding case requires them;
- minimum liquidity through ramp-up.

The total funding requirement should reconcile to the development schedule and the period of peak negative cash flow, not merely to a headline CAPEX number.

## Mining capital and financeability — conditional module

Apply this section only where the model is being used to assess mine funding,
bankability, refinancing, capital structure, investor returns or a mining-specific
financing instrument. Generic interest calculations, debt waterfalls, covenant formulae,
security documentation and legal drafting remain in the core audit/finance skill.

### Capital source should fit mine development stage

Mining capital is not interchangeable across the project lifecycle. The source and form
of funding should be plausible for the maturity and risk of the mineral project.

- **Exploration / early Resource definition:** capital is normally risk-bearing because
  geology, metallurgy, mine design and economics remain unresolved. Equity, staged
  farm-in/JV or other strategic risk capital can be structurally more plausible than
  senior project debt.
- **PFS / FS development:** funding may combine equity or strategic capital with staged
  development/farm-in funding as technical confidence improves. The model should not
  assume construction-style debt capacity before the project has the technical and
  commercial basis required by that lender case.
- **Construction / commissioning:** project debt, development finance, streams,
  royalties, offtake prepayments and contractor/equipment finance can become relevant
  where the mine has sufficient technical maturity, rights, execution plans and product
  market support.
- **Operating / expansion / refinancing:** producing mines generally have a wider range
  of capital because operating history, saleable product and cash flow can support
  additional financing structures.

These are directional mining-finance principles, not mandatory instrument choices. A
specific transaction can differ if its risk allocation and security are supportable.

### The financeable mining case is a physical-commercial package

A positive NPV is not by itself a financeable mine. Where funding is a stated purpose of
the model, understand whether the financing case is supported by the mining facts that
capital providers depend on, including as applicable:

- current and sufficient mineral rights/tenure and required surface access;
- an appropriately mature Resource/Reserve, mine plan and feasibility basis;
- technically demonstrated mining and processing routes;
- water, power, tailings/waste, logistics and other critical infrastructure;
- a credible construction, commissioning and ramp-up plan;
- saleable product specifications and an economically credible market/offtake route;
- material environmental, social, closure and permitting requirements;
- contractor/EPC/EPCM/O&M assumptions that are consistent with the model;
- a funding requirement that covers the path through stable production, not merely
  equipment/construction CAPEX;
- the capacity of the mining team, contractors and counterparties to execute the plan.

A missing item is not automatically a model failure if it is outside scope or genuinely
not required for the project. It is a bankability challenge when the funding case relies
on it but the model assumes it exists without evidence or a visible condition/limitation.

### Reserve tail and financing horizon

Mine debt and other fixed funding commitments are exposed to a depleting asset. Where
repayment depends on mine cash flow, the financing horizon should leave a supportable
period or quantity of economically mineable inventory after scheduled repayment rather
than relying on production through the last Reserve tonne.

Do **not** apply a universal reserve-tail percentage. Assess the cushion using the actual
Reserve-based production schedule, debt/funding maturity, ramp-up risk, commodity and
cost volatility, sustaining capital, closure obligations and any lender-defined basis.
Where repayment depends materially on Inferred Resources, exploration upside or an
unapproved mine-life extension, make that dependency explicit rather than treating the
inventory as equivalent to Reserve.

### Mining completion and ramp-up are operational, not merely construction milestones

For a financed development mine, completion can depend on more than physical
construction. The model may need to distinguish construction completion from the point
at which the mine, plant and logistics chain demonstrate the operating performance on
which financing relies. Depending on the project, relevant evidence can include:

- ore access and mine development sufficient for planned feed;
- sustained mining/plant throughput and availability;
- metallurgical recovery and saleable product quality;
- tailings/waste, power, water and logistics performance;
- successful commissioning and ramp-up over an appropriate period;
- permits and operating conditions remaining effective.

A financing case that assumes full debt service, distributions or refinancing immediately
on mechanical completion should be challenged if the mine still faces a material
commissioning/ramp-up performance test.

### Streaming finance changes the economics of future metal

A metal stream provides upfront capital in exchange for rights to purchase a stated share
of future metal or metal credits at the contractual purchase price. It is not economically
free capital. Where a stream is modelled, preserve the link between the stream terms and
the physical production profile:

- streamed percentage/metal and delivery quantity;
- contractual purchase price or price formula;
- term, thresholds, caps, step-downs or buy-back features where material;
- treatment of by-products and changes in mine plan;
- effect on project realised revenue, margins, cut-off economics and residual value.

Do not count the upfront stream proceeds as funding while also valuing the streamed
metal at the project's full unencumbered market revenue. If stream terms continue after
senior debt is repaid, the burden can remain throughout a material part of mine life.

### Royalty finance creates a long-dated claim on mine economics

Where an investor provides upfront capital in return for a project royalty, distinguish the
**financing royalty** from government/state royalties, private land/mineral royalties and
other fiscal charges. Identify the royalty base — gross revenue, NSR/netback, profit or
another contractual basis — and apply the correct deductions and duration.

A financing royalty can change marginal ore economics, Reserve conversion, mine life and
value even though it does not create scheduled principal repayments. Do not model the
upfront funding benefit without the corresponding future royalty burden, and do not
silently duplicate the same royalty in both financing and operating/fiscal schedules.

### Offtake/prepayment finance is linked to physical product delivery

Offtake or pre-production finance can provide working/development capital against future
mineral deliveries, particularly for bulk commodities, concentrates and products with
specialist traders or buyers. Where modelled, reconcile:

- committed tonnes/metal and product specifications;
- delivery point and logistics path;
- pricing formula, discounts, provisional pricing or other deductions;
- prepayment timing and how it is recovered through future deliveries/cash settlement;
- minimum/maximum delivery obligations and other material take-or-pay style effects;
- remaining uncommitted production available for other buyers or financiers.

Do not count an offtake prepayment as ordinary revenue and then again recognise the same
future shipment at full unencumbered sales proceeds without the contractual repayment or
price adjustment.

### Contractor/vendor and equipment finance can move CAPEX into mine operating costs

Mining or processing contractors may fund equipment or plant in exchange for a contract
long enough to recover their capital through fixed charges, unit mining/processing rates,
profit share or another operating payment. This can reduce upfront owner CAPEX but does
not remove the economic cost of the equipment.

Where vendor/equipment finance is material, check that:

- the contract duration is consistent with the Reserve/mine life and production profile;
- fixed and variable contractor charges reflect the capital-recovery mechanism where
  intended;
- equipment capacity and contractor performance assumptions support the mine plan;
- owner CAPEX does not also include equipment already recovered through contractor
  charges unless the ownership/payment structure genuinely requires both;
- shutdown, low-volume or early-closure cases recognise any continuing minimum payment,
  termination or unrecovered-capital exposure where material.

### Farm-in and staged strategic funding should follow technical milestones

For exploration/development farm-ins, capital can be committed in tranches in exchange
for a progressively earned project interest. A model using such funding should preserve
which work program or technical milestone unlocks each tranche and when ownership or
economic interests change. The value of later tranches should not be treated as certain
funding if the investor has discretion to stop after an unsuccessful stage.

### Multiple mining-capital instruments can encumber the same future cash flow or product

A project can combine equity, debt, streams, royalties, offtake prepayments and contractor
finance. The model should reconcile the combined claims on the mine rather than testing
each instrument in isolation. In particular, identify whether the same future ounces,
tonnes, receivables, project assets or free cash flow are simultaneously committed to
multiple capital providers.

The finance case should show the **residual** project economics after all material product
commitments, royalties, contractor capital-recovery charges and debt service. A funding
stack that looks viable instrument-by-instrument can fail when the claims are combined.

### Mining-finance due diligence should challenge the physical value chain

Where the model supports a financing decision, technical due diligence should interrogate
the mining assumptions that create repayment capacity: geology/Reserve confidence, mine
plan, dilution/loss, processing recovery, infrastructure, water/power, logistics, product
market, licences/land access, environment/community/closure and execution capability.
Independent technical review or site evidence can be particularly important where a
material assumption cannot be established from documents alone.

Do not make a site visit a universal requirement of this model-review skill. If site-specific
conditions are decision-critical and no independent/site evidence is available, state the
limitation or request evidence rather than pretending the spreadsheet resolves it.

## Mining risk, sensitivity and adaptive decision-making

### Risk ranges should reflect mining reality

Sensitivity ranges should be tied to plausible project uncertainty rather than automatic `+/-10%` or `+/-25%` movements. Material mining sensitivities can include:

- commodity and product price;
- FX;
- reserve tonnes and grade;
- dilution and ore loss;
- metallurgical recovery and product quality;
- mining and processing throughput;
- ramp-up and availability;
- strip ratio or underground development intensity;
- mining, processing, power, reagent, logistics and labour costs;
- initial and sustaining CAPEX;
- construction or permitting delay;
- royalty/tax terms;
- closure cost and timing.

If a risk is physically linked to another driver, consider the dependency. For example, lower grade can increase tonnes processed per unit of metal and therefore energy and reagent intensity; higher throughput can alter recovery; commodity price can change cut-off and mine life.


### Risk-adjusted discount rates do not replace mining risk analysis

A higher discount rate may be appropriate to reflect the investor's required return or a project's overall
risk context, but it should not become a dumping ground for identifiable mining risks. Geological uncertainty,
recovery variability, ramp-up failure, schedule delay, capex escalation, water constraints, permitting risk and
closure exposure affect the timing or amount of cash flow in different ways. A single uplift to the discount
rate cannot show those mechanisms and can suppress upside as well as downside.

Where a material risk can be represented explicitly and decision-usefully, prefer cash-flow cases, probability
ranges, decision trees, re-optimised scenarios or other transparent mining-specific treatment. A qualitative
risk register is useful for identifying risk, but material items should be connected back to the physical mine
plan or economics rather than left as a stand-alone heat map. Avoid double counting by both reducing cash
flows for a risk and adding an unexplained additional risk premium for the same exposure.

### Geological, technical and economic uncertainty can be coupled

Mining uncertainties should not automatically be treated as independent scalar inputs. A change
in the geological interpretation can alter several downstream quantities at once. Examples include:

- lower or more variable grade changing saleable metal, unit cost per unit of product and mine life;
- geotechnical conditions changing slope/stope design, dilution, ground support, mining rate and capital;
- hydrogeology changing dewatering, access, schedule, power and closure requirements;
- ore mineralogy changing recovery, reagent consumption, product quality and treatment penalties;
- lower confidence in continuity changing mine sequence, equipment utilisation and the amount of
  inventory that can credibly support a production schedule.

Where a model applies uncertainty to one of these drivers, check whether the linked consequences
remain physically coherent. Applying a probability distribution to grade while holding recovery,
throughput, unit cost, schedule and cut-off mechanically fixed can materially understate or misstate
the real uncertainty if those variables are causally connected.

### Monte Carlo and probabilistic analysis

Probabilistic modelling can be useful where the model has supportable ranges or distributions. Review whether:

- the selected uncertain variables are actually material to the mine;
- distributions and ranges have a technical or commercial basis;
- correlations or common drivers are considered where material;
- deterministic contingencies are not double counted with stochastic uncertainty;
- enough iterations are used for the required decision precision;
- outputs are reported as distributions/percentiles rather than a single pseudo-precise value;
- the tails and downside probability are understood, not only the mean NPV.

A Monte Carlo model of a **static mine plan** is still static decision logic. It may show the distribution of outcomes without capturing how management would re-optimise the mine when prices, costs or technical conditions change.

A deterministic base case is not automatically the statistical expected value of a mine. Likewise,
an "upside" case in which every favourable variable moves together and a "downside" case in which
every adverse variable moves together can create implausible extremes unless those joint movements
are supported. Scenario and probabilistic cases should respect the direction, persistence and
correlation of the underlying mining drivers where those relationships are material.

### Sensitivity ranges are not probabilities

A tornado chart or one-at-a-time sensitivity shows how value changes when an input is moved; it does not establish how likely the input movement is. Do not describe the outer values of a sensitivity table as confidence limits, P10/P50/P90 outcomes or valuation probabilities unless actual probability assumptions support that interpretation.

Where a decision depends on the probability of a loss, covenant breach, funding shortfall or negative NPV, use probability/scenario evidence that reflects plausible joint mining outcomes rather than inferring probability from the width of a sensitivity bar.

### Re-optimisation under changed conditions

Where a sensitivity materially changes a driver that would alter the optimal mine plan, challenge whether the plan should also change. Examples:

- a higher/lower commodity price may change cut-off grade, pit limits, stope selection, stockpile strategy and mine life;
- a material recovery change may alter routing or plant economics;
- a schedule delay may change escalation, financing, contract pricing and market exposure;
- a major FX movement may change imported-input costs and development strategy.

A sensitivity that leaves the entire physical plan frozen can still be useful as a first-order measure, but it should not be presented as a fully optimised economic response if management would realistically change the plan.

### Real options and management flexibility

For mining decisions with material future flexibility, conventional DCF may understate or misstate value because it assumes the original plan is followed. Consider whether the project has economically meaningful options to:

- defer development;
- stage or expand capacity;
- switch processing routes or product forms;
- temporarily shut down and restart;
- accelerate or slow production;
- abandon a stage;
- close early;
- extend the pit or underground mine if future conditions justify it.

Real-options valuation (ROV), decision-tree analysis or another adaptive method may be useful when the value of this flexibility is material. It is **not mandatory for every mining model**. The test is whether ignoring management response could change the strategic decision.

For early-closure or mine-life options, include the changing closure liability and any capital/infrastructure consequences. A negative deterministic cash flow in later years does not automatically prove those years have zero strategic value if the operation can choose whether to continue after observing future market conditions.


### Operational flexibility must be physically exercisable

A model should not assign value to a mining option merely because an economist can describe it.
The mine must be capable of exercising the option on realistic terms. For shutdown/restart,
care-and-maintenance, grade-control or method-switching cases, consider where material:

- minimum care-and-maintenance labour, pumping, ventilation, water treatment, security and
  environmental-monitoring costs;
- restart mobilisation, workforce, contractor, maintenance and re-commissioning costs;
- restart lead time and any lost access, ground-condition or plant-integrity consequences;
- take-or-pay, power, rail/port, offtake, equipment-finance or contractor commitments that continue
  through shutdown;
- stockpile and inventory consequences;
- licence, permitting, rehabilitation-security or other regulatory constraints on suspension;
- whether mine geometry, development state or process configuration actually permits the proposed
  change in mining rate, grade strategy or method.

An undeveloped or temporarily uneconomic mineral property can retain strategic option value when
the owner has the genuine right and ability to wait. That optionality is weakened or eliminated by
tenure expiry, unavoidable holding expenditure, mandatory work commitments, irreversible
infrastructure choices or other constraints that remove the ability to defer.

## Mining valuation and product-form economics

### Commodity-price basis for Resource, Reserve and mine valuation

Commodity price is both a valuation input and, in many projects, a mine-design input because
it changes cut-off, pit/stope limits, stockpile strategy and the amount of material with
reasonable prospects of economic extraction. Price selection must therefore be supportable for
the commodity, project stage and intended use.

Potential bases include long-term historical averages, moving averages, consensus forecasts,
contract prices, cost-curve analysis, current/spot prices or specialist forecasts. None is
universally preferred. Consider:

- expected timing of production and duration of the mine;
- commodity cyclicality and whether current price is at an unusual point in the cycle;
- consistency between long-term commodity prices and long-term FX assumptions;
- product quality, payability and contract/offtake adjustments relative to benchmark price;
- whether the price used to define the Reserve/mine plan differs from the price used to prove DCF viability.

Where the Reserve production schedule was optimised using one price/value assumption and the
economic model uses another, show the rationale and the economic result at the Reserve-design
price basis as a cross-check. Downside price sensitivity should not be omitted merely because the
base case is positive.

### Forecast prices, forward curves and hedged realised prices

Distinguish three different concepts that are often collapsed in mining models:

1. **Economic price forecast:** the price assumption used to test long-run mine economics and Resource/Reserve viability.
2. **Forward/futures curve:** the market price today for delivery at specified future dates. It may reflect financing, storage, convenience yield, liquidity and market structure and is not automatically an unbiased forecast of the future spot price.
3. **Contractual/hedged realised price:** the actual price exposure created by physical offtake, forwards, puts/calls, collars or other instruments over stated tonnes/ounces and periods.

A model should not use a forward curve as a long-term economic forecast merely because it is observable, nor assume that a hedge eliminates all price exposure. Hedging can introduce basis, volume, timing, liquidity/margin-call and counterparty exposure and can cap upside as well as protect downside.

Where hedges are material, choose a coherent treatment: incorporate the contractual hedge cash flows/realised prices into the project cash flow, or value a separable hedge position explicitly where that is appropriate to the model purpose. Do not both embed the hedge in realised revenue and add the same mark-to-market asset/liability again.

### Commodity cycles, market depth and the price-taking assumption

Mineral prices cannot be validated simply by extending a recent historical trend. For material
price assumptions, understand the commercial mechanism that connects the mine's product to the
assumed benchmark or contract price. Relevant considerations can include:

- the mine's expected date of first production relative to the price deck;
- inventory cycles, substitution, recycling, technology change and new competing supply;
- whether the product is an exchange-traded commodity, bulk commodity, concentrate, industrial
  mineral, specialty product or minor metal;
- the depth of the addressable market and realistic offtake capacity for the specified product quality;
- whether the project is small enough to be a price taker or whether its planned output is material
  enough to affect market clearing, realised discounts or contract terms.

For a large new source of a thinly traded mineral or a product with limited qualified buyers, do not
assume that production volume and realised price are independent. Conversely, do not force a
market-impact adjustment onto a modest mine selling a deep, liquid global commodity without
evidence that its output can move the market.

Because early production years carry disproportionate present-value weight, development timing can
materially affect project value in cyclical commodities. Timing sensitivity or deferral analysis can be
decision-useful where the project has genuine discretion over start date, but the model should not
assume management can forecast and perfectly time future commodity cycles.

### Long-term price and mine-supply economics

For long-life mining decisions, a commodity-price deck should be challenged against the economics of the
underlying market as well as historical or consensus statistics. Industry cost curves, marginal producer
economics, announced/credible new capacity, depletion, substitution, recycling, demand shifts and project
lead times can provide useful corroboration for whether a long-term price assumption is economically
plausible.

Do not treat an industry cost curve or historical trend regression as a deterministic price forecast. Cost
curves can move with FX, energy, grade decline, technology and closures; demand can shift structurally; and
future capacity is uncertain. Use supply-demand/cost-curve evidence as triangulation and scenario context,
not as a universal formula that overrides current project-specific commodity-price guidance.

### Mining industry cost curves and by-product normalisation

Industry cost curves can provide useful context for operating resilience and market position, but
they are highly sensitive to definition. Before comparing a mine with peers, normalise where
material for:

- product form, grade/quality and payable basis;
- mining/processing boundary and cost scope;
- treatment, refining, freight and other selling costs;
- by-product and co-product credits;
- sustaining/replacement capital included or excluded from the metric;
- jurisdiction, currency, base date, inflation and FX;
- royalties, taxes, subsidies and other government charges included or excluded.

For an existing producer's short-run shutdown decision, historical sunk development capital is not a
go-forward cash cost. For a new mine investment decision, however, development capital and the
required return on that capital cannot be ignored merely because an operating-peer cost curve
excludes them. Do not compare a new project's full-life economics with an incumbent producer's
cash operating cost and treat the difference as evidence of competitiveness.

Where by-products are material, ensure credits are derived from recoverable/payable co-product
economics and are applied consistently. A low reported unit cost created by a large by-product
credit can obscure the economics of the primary product and may not remain stable when relative
commodity prices change.

### Mineral-property stage and valuation approach

Match the valuation method to the maturity of the mineral property:

- **Exploration property:** market and cost-based approaches are often more supportable than a full mine DCF when no defined Resource or credible development plan exists.
- **Mineral Resource property:** market methods are relevant; income/DCF may be appropriate only where the technical/economic basis is sufficiently developed; cost methods can have a role in some cases.
- **Development property:** income/DCF and market approaches are normally supportable because PFS/FS-level economics exist; a cost-only approach is generally weak.
- **Producing property:** income/DCF and market approaches are normally central; historical operating/reconciliation data should inform the analysis.

Where reasonably possible, compare more than one supportable valuation approach and reconcile
material differences. Do not cherry-pick the highest method. **Gross in-situ metal value**
(contained metal multiplied by spot price) is not an acceptable measure of mineral-property value
because it ignores recovery, cost, time, risk and modifying factors.

Valuation must use mineral inventory that is current enough for the valuation date. If historical
or non-current Resource/Reserve estimates are used, explain the effect of subsequent drilling,
production, depletion, reclassification, technical changes and changed economic assumptions.

### Asset-level DCF and terminal value

A producing or development-stage mine with a defined life-of-mine schedule is naturally suited to DCF valuation. Unlike a perpetual business, a depleting mineral asset should **not receive a conventional perpetual-growth terminal value by default**.

Potential end-of-model value must be supported by something economically real, such as:

- residual saleable inventory;
- salvage value;
- recoverable working capital;
- an explicitly valued extension resource or reserve-conversion case;
- a separate expansion/continuation option;
- other non-mining assets.

Do not add a generic terminal multiple simply because the DCF ends.

### NAV / sum-of-parts mining valuation

Where a corporate mining valuation uses net asset value (NAV), distinguish:

- NPV of each mining asset or project;
- cash and liquid investments;
- debt and other financing liabilities;
- minority or non-controlling interests;
- equity investments or non-mining assets;
- corporate overhead or other corporate-level adjustments.

Check that debt, cash, corporate costs and interests are not already embedded in asset NPVs before adjusting NAV. Asset-level DCF is often unlevered; equity valuation adjustments are then made at the corporate level.

Market ratios such as P/NAV can provide market context but are not evidence that the underlying mine model is correct.

### Early-stage physical multiples and comparable mineral inventory

Measures such as enterprise value per Resource tonne/ounce can be useful for early-stage market comparison, but they do not capture the cost, recovery, timing, infrastructure or fiscal burden required to extract the metal. They are **not substitutes for economic mine valuation** when enough technical information exists to build a project cash flow.

When a physical Resource/Reserve multiple is used, normalise comparables for the attributes that drive economic conversion rather than comparing contained units alone. Relevant differences can include:

- Resource/Reserve category and proportion of lower-confidence material;
- cut-off grade/value and whether reported inventories are inclusive or exclusive of Reserves;
- grade, deposit geometry, depth and mining method;
- metallurgical recovery, product form and payable terms;
- infrastructure, jurisdiction and development stage;
- scale, expected capital intensity and timing to production;
- co-product/by-product value and other material assets or liabilities embedded in enterprise value.

A low EV/Resource unit can reflect undervaluation, but it can equally reflect lower confidence, weak grade, difficult metallurgy, infrastructure burden, country risk or a long/uncertain path to development.

### Earn-in, farm-in and staged exploration transactions as valuation evidence

An arm's-length earn-in or farm-in can provide market evidence for an exploration property, but interpret the economics of the transaction correctly. Distinguish:

- cash paid to the existing owner from expenditure committed directly to the property;
- interest earned at each stage;
- mandatory minimum spend versus optional future stages;
- withdrawal rights, milestones, performance conditions and dilution mechanisms;
- timing and probability that later stages will actually be funded.

A staged transaction does not imply that every future committed-looking dollar should be capitalised at face value on day one. Where future stages are discretionary, their implied value depends on the probability of reaching and exercising those stages and on what new geological information is expected to be known before the next decision. Treat the resulting implied value as one piece of market evidence, not automatically as definitive fair market value.

### Product-form alternatives

When a mine can sell different product forms — for example concentrate versus refined metal, direct-shipping ore versus beneficiated product, or domestic versus export product — compare the full value chain. Relevant differences can include:

- recoveries and yield;
- payability;
- treatment and refining charges;
- freight, insurance and marketing;
- penalties/bonuses;
- incremental plant and infrastructure CAPEX;
- power and reagent intensity;
- working capital and payment terms;
- taxes, royalties and duties;
- schedule and technical risk.

A higher headline product price does not by itself establish the better route.

## Mining fiscal-regime interactions and behavioural responses

### Cumulative fiscal burden matters

Royalties and taxes affect mine design as well as after-tax returns. In a mining project they can influence:

- economic cut-off grade;
- reserve conversion;
- annual production rate;
- mine life;
- processing route;
- investment timing;
- closure of marginal operations.

Review the **combined** fiscal effect rather than judging each tax in isolation when the project decision depends on cumulative government take.

### Royalty rates cannot be compared without the royalty base

A 3% royalty on gross sales is economically different from a 3% royalty on NSR, netback, profit or a production-unit base. When benchmarking fiscal terms, compare both the rate and the definition of the base, including allowable deductions and whether the royalty is incremental or applied to the whole base after a threshold is reached.

Sliding-scale royalties require special care around thresholds. Check for:

- cliff effects or discontinuities;
- incremental versus whole-base application;
- price/realised-value definitions;
- related-party pricing;
- deductions and product payability;
- behaviour close to a royalty-rate threshold.

### Fiscal valuation points, netbacks and project ring-fencing

Identify the physical/commercial **valuation point** for each material mining fiscal
instrument. Royalty may be assessed at mine mouth, plant gate, FOB/export point or sale point,
while income tax can use a different revenue/cost boundary. If the benchmark/sale price occurs
downstream of the fiscal point, a netback may deduct only the transport, treatment, refining or
other costs allowed by the governing fiscal rules.

Do not assume the same valuation point or deductions apply to every tax. Related-party sales,
management/service charges and related-party financing can change the taxable base and should be
considered when material.

Project **ring-fencing** also matters. Determine whether exploration losses, development
deductions, interest, rehabilitation or other costs can be offset against income from other mines,
licences, entities or tax periods. A model can materially overstate tax shields by pooling losses
that are legally/project-specifically ring-fenced.

### Government-take and marginality analysis — conditional

Apply this subsection only when the model's purpose includes mining fiscal-regime design,
government revenue, concession negotiation or comparison of fiscal packages. In addition to
project NPV/IRR, useful mining-fiscal measures can include:

- total and time-profiled government revenue by instrument;
- discounted **average effective tax rate / government take** relative to pre-tax economic rent/cash flow on a consistent basis;
- the tax burden at the margin of project viability, including the wedge between pre- and post-tax economics where relevant;
- breakeven commodity price or other threshold required to achieve the investor's stated post-tax return;
- **progressivity** — whether government share rises with project profitability and falls as the mine approaches marginality.

Do not use one government-take percentage as a complete judgement on a fiscal regime. A package
with the same average take can differ materially in timing, marginal burden, progressivity and
effect on cut-off, mine life and investment.

### Tax incentives can change mine behaviour

Where the model explicitly evaluates mining tax incentives, do not assume the direct statutory cost is the full economic effect. Possible mining-specific behavioural responses include:

- **income-tax holidays:** acceleration/high-grading of production into the tax-free period, potentially shortening mine life or leaving lower-grade material unmined;
- **royalty holidays:** shifting production or sales timing into the exempt period where operationally possible;
- **processing-zone or related-party incentives:** underpricing ore/concentrate sold to a lower-tax affiliated processor;
- **withholding-tax relief on interest/services:** increasing related-party debt, interest rates, repayment periods or management/service charges;
- **accelerated depreciation or cost-based incentives:** over-investment or 'gold plating' of qualifying capital;
- **import-duty relief:** inflated equipment prices or related-party procurement where controls are weak;
- **fiscal stabilisation:** locking in an incentive structure that later proves more costly than anticipated.

If the purpose is to estimate the cost of an incentive, distinguish:

1. benchmark fiscal regime;
2. direct incentive case;
3. incentive plus plausible behavioural response;
4. total government-revenue effect and investor-return effect.

Multiple incentives can interact. Their combined cost is not necessarily the sum of stand-alone incentive costs.

## In-situ recovery (ISR) mining — conditional module

Apply this section only when the project uses in-situ recovery / in-situ leaching or a materially similar solution-mining method.

### ISR physical chain

The economic model should reflect the ISR process chain rather than forcing it into conventional open-pit/underground tonnes-mined logic:

`host geology/hydrology → injection wellfield → lixiviant contact → pregnant leach solution (PLS) → extraction wells → SX/IX or other separation → electrowinning/refining or product recovery → raffinate/recycle → waste/water management`

Relevant physical drivers can include:

- permeability and porosity;
- mineralogy and oxidation state;
- aquifer geometry and connectivity;
- groundwater level and flow;
- injection/extraction/monitoring well count and spacing;
- well flow rate and uptime;
- lixiviant and oxidant type;
- reagent strength and consumption;
- PLS grade and flow;
- recycle/recovery of lixiviant;
- process recovery in SX/IX/EW or other recovery stages;
- wellfield development and replacement rate.

### ISR recovery and production logic

ISR recovery is not simply `resource tonnes × grade × constant recovery`. Production can depend on leaching kinetics, fluid flow, wellfield sequencing, chemistry, permeability, solution loss and changing PLS grade.

Test whether annual saleable metal reconciles through the process mass balance from the wellfield to the final product. Where the model estimates cathode production, trace at least:

- PLS flow and copper/metal concentration;
- extraction/separation efficiency;
- enriched electrolyte or equivalent intermediate;
- electrowinning/refining recovery;
- recycle and residual metal assumptions.

If a key intermediate is unavailable and replaced with a peer assumption, the model should make that limitation visible and sensitise it if material.

### ISR cost structure

ISR can avoid some conventional mining costs but creates a different cost base. Depending on the project, review:

- drilling and wellfield CAPEX;
- pumps, piping and surface infrastructure;
- SX/IX/EW or alternative process plant;
- sustaining well replacement/development;
- lixiviants, oxidants, resin and other consumables;
- electricity for pumping and processing;
- water treatment and monitoring;
- environmental containment and remediation;
- labour, maintenance and site services.

Reagent and energy intensity should move with the physical production/recovery assumptions where the relationship is material.

### ISR environmental and hydrogeological economics

Permeability and hydrology are both production drivers and environmental constraints. The economic case should not assume fluid movement that supports production while ignoring the monitoring, containment, water-treatment or closure obligations required by the same hydrogeological conditions.

Where a lixiviant can react adversely with pyrite, sulfides or groundwater chemistry, the model should include the resulting technical/operational assumptions and associated cost/risk if material to feasibility.

### ISR benchmarking

When benchmarking ISR against conventional mines or peer ISR projects, normalise for scale, stage, jurisdiction, recovery, product form and included cost scope. Per-tonne or per-unit-metal comparisons can be useful, but peer costs do not replace project-specific hydrology, chemistry and wellfield data.

## Deep-sea and polymetallic-nodule mining — conditional module

Apply this section only where the project concerns polymetallic nodules or another offshore/deep-sea mineral system.

The model may require a different physical chain from land-based mining, including:

- nodule/resource grade by metal;
- annual collection/ore production;
- collection-system capacity and recovery;
- riser/lift and surface-vessel systems;
- offshore logistics;
- onshore processing plant;
- multiple metal recoveries and product streams;
- annual licence/contract fees and royalty/payment mechanisms;
- long construction and operating periods.

For polymetallic nodules, metal-equivalent or nickel-equivalent grades are screening tools only if they transparently use the live metal prices and recoveries of each contributing metal. The full project decision should still use DCF/NPV and the actual multi-metal revenue/cost structure.

Break-even grade can be a useful macro screening measure, but do not treat a simple `cost / metal price` threshold as the complete economic cut-off where there are multiple metals, different recoveries, royalties, processing costs, financing and long-dated capital.

Probability distributions for annual collection rate, grades, recoveries, CAPEX, OPEX and royalties can be useful where uncertainty is material. Do **not** generalise a case-study conclusion about a specific royalty percentage into a universal deep-sea mining rule.

## Placer mining — conditional module

Apply only to alluvial/placer operations or other unconsolidated deposits whose economics are
dominated by bulk excavation and gravity/mineral separation. Historical equipment cost curves
from older handbooks are **not current benchmark costs**; use them only for physical concepts and
obtain current project-specific rates for valuation.

### Placer deposit definition and mine design

A credible placer cost estimate requires a technically feasible mine design. Important drivers can
include deposit geometry/volume, pay-gravel distribution, overburden thickness, bedrock depth and
profile, topography, particle/mineral characteristics, water, power, access, environmental
constraints, labour and seasonal/camp requirements. Resource-definition quality directly affects
the reliability of both grade and cost estimates.

### Bank volume, loose volume and equipment sizing

Distinguish in-situ **bank volume** from excavated **loose volume** after swell/shrinkage.
Excavation, haulage and materials-handling equipment are often volume-constrained. Where swell is
material, sizing/costing equipment directly from bank cubic metres/yards can understate the volume
actually moved. Ensure units remain consistent across Resource, overburden, mining and processing
schedules.

### Mine–mill–tailings capacity balance

The excavation/feed system, processing plant, oversize handling and tailings removal must be
compatible. A placer model should not size mine production independently of mill feed capacity or
ignore the capacity needed to remove tailings/oversize. Material handling should minimise
unnecessary rehandling and avoid placing waste/tailings where future pay gravel must be mined.

### Gravity processing, water and environmental systems

Gravity separation depends on both density and particle size; size classification can therefore be
as important as the concentrator itself. Where relevant, the model should recognise:

- maximum feed rate and a material balance for feed, concentrate, tailings and oversize;
- the purpose and capacity of rougher/cleaner/scavenger or other recovery stages;
- water supply, pumping, recycle and settling-pond requirements;
- generator/power, camp/services and seasonal lost-time requirements;
- tailings placement, water management and progressive/final reclamation.

These supplemental systems can be a material share of a small placer operation's cost base and
should not be omitted simply because they do not directly recover mineral.


## Mining benchmark discipline

Do not use fixed generic EBITDA, IRR, DSCR, gearing, royalty, recovery, unit-cost or
mine-life ranges as pass/fail criteria. Mining benchmarks are meaningful only when
normalised for commodity, deposit type, mining method, process route, product form,
scale, study stage, jurisdiction, base date, currency and cost scope.

Where peer or market benchmarks are used, record what is being compared and why it
is comparable. Prefer project-specific operating history, current technical studies,
contract terms, competent/qualified-person work and appropriately normalised peer
information over timeless rule-of-thumb ranges.

Historical project-evaluation rules of thumb — including fixed hurdle rates, payback limits,
cost-curve percentiles or formulaic option-value uplifts — are not universal current criteria.
Use them, if at all, as context to be validated against the project, commodity, jurisdiction,
capital market and valuation date.

## Common mining model failure patterns

These are mining-domain failure patterns. Generic spreadsheet, accounting,
financing or governance failures are handled by the core audit skill.

1. **Closure economics missing:** rehabilitation, decommissioning, monitoring or residual closure cash flows are omitted or economically inconsistent with the mine plan.
2. **Static breakeven cut-off under a binding constraint:** cut-off uses direct cost only even though mine, plant, refinery, logistics or sales capacity is fully utilised.
3. **Internal/external cut-off confusion:** unavoidable mining cost is charged to material already mined, or incremental mining/stripping cost is omitted where material can remain in the ground.
4. **Cut-off changes without grade–tonnage response:** cut-off changes materially but tonnes and average feed grade do not respond without geological or routing explanation.
5. **Recovery held constant through a material grade/throughput change:** known grade-, mineralogy- or throughput-dependent recovery relationships are ignored.
6. **Polymetallic value reduced to an unsupported fixed equivalent grade:** live grades, recoveries, payabilities, TC/RC, freight, penalties and prices do not flow into value/routing.
7. **Stockpile economics incomplete:** deferred tonnes lack rehandling, time value, recovery/weathering, maintenance or future-process economics where material.
8. **Cut-off/capacity plan not iterated:** mining rate, plant size, cut-off and schedule are changed independently despite being economically interdependent.
9. **Selectivity/model mismatch:** mining method, stope/bench geometry, equipment size or ore-control changes without corresponding dilution, loss or grade–tonnage response.
10. **Product blend violates specifications:** blend tonnage is maximised without satisfying product-quality, deleterious-element or source-tonnage constraints.
11. **Ratio blending calculated incorrectly:** a product-quality ratio is averaged directly rather than recalculated from blended numerator and denominator quantities.
12. **Sunk/sustaining cost confusion in mine routing:** historical sunk capital is charged to a marginal routing decision or future sustaining capital required to realise that route is omitted.
13. **Real/nominal mining basis mismatch:** commodity prices, opex, capex, closure and discount rates use incompatible price bases.
14. **Royalty/resource-levy base mismatch:** gross value, NSR/netback, units, profit or sliding-scale bases are collapsed into an incorrect generic revenue percentage.
15. **Mineral-rights depletion mismatch:** production-based depletion/amortisation is disconnected from eligible basis and reserve/production quantities, or tax and accounting deductions are double counted.
16. **Tax-loss timing overstated:** construction/ramp-up losses are monetised before the project/tax group can use them or despite project ring-fencing.
17. **Mining working-capital terminal mismatch:** product/in-process inventory, consumables, receivables or final release do not follow the production/sales profile or double count terminal inventory.
18. **Export FX / hard-currency exposure mismatch:** commodity revenue, local costs, imported inputs, taxes/royalties and hard-currency debt are not treated coherently.
19. **Alternative mine plans compared on inconsistent economic basis:** valuation date, tax basis, currency, funding or asset opportunity cost differs between alternatives without adjustment.
20. **Mining sensitivity misses physical value drivers:** price-only or discount-rate-only sensitivity omits material grade, recovery, throughput, strip/development, cost, sustaining-capex, schedule, FX or closure risks.
21. **Exploration expected value without survival/funding logic:** probability-weighted NPV ignores failure-stage cash burn, next-stage funding and stop/defer/farm-out choices.
22. **Closure-driven non-unique IRR:** late negative closure cash flows create multiple sign changes but one IRR is presented as definitive without NPV/XNPV challenge.
23. **Study-stage evidence mismatch:** a model described as PFS/FS/BFS or finance-ready relies on evidence materially below that study maturity.
24. **Resource/reserve confidence mismatch:** Inferred or other lower-confidence inventory is treated as committed Reserve production without transparent category and modifying-factor support.
25. **Modifying-factor disconnect:** material mining, metallurgical, geotechnical, hydrogeological, environmental, infrastructure, marketing, legal, social, governmental or economic changes do not propagate into the Reserve/mine plan.
26. **Cross-discipline feasibility mismatch:** mine schedule, process design, power/water, waste/tailings, infrastructure, logistics, permitting or closure describe different physical projects.
27. **Contingency double count:** estimate, escalation, schedule or technical uncertainty is counted both deterministically and probabilistically without reconciliation.
28. **Funding requirement ignores mining ramp-up liquidity:** development funding excludes pre-production operating costs, initial fills/spares/inventory, working capital or losses to stable production.
29. **Arbitrary mining sensitivity ranges:** standard percentages are used instead of uncertainty tied to the actual geology, engineering, market or execution basis.
30. **Static-plan risk illusion:** Monte Carlo varies inputs but retains a mine plan that would realistically be re-optimised.
31. **Management flexibility omitted from a strategic mine-life decision:** defer, stage, expand, shut/restart, route-switch or close options are economically material but ignored.
32. **Perpetual terminal value on a depleting Reserve:** terminal value has no residual inventory, salvage, extension resource/reserve or separately justified option/asset.
33. **Mining NAV double count:** mine-asset NPVs and corporate adjustments overlap or mix leveraged/unleveraged bases.
34. **Physical multiple treated as intrinsic mine value:** EV/resource, value-per-ounce or similar measure substitutes for extraction economics when sufficient technical information exists.
35. **Fiscal-rate comparison ignores royalty/tax base:** rates are compared without normalising gross value, netback, profit, production or threshold mechanics.
36. **Mining tax incentive ignores behavioural response:** high-grading, production shifting, related-party pricing, leverage or qualifying-capex changes are excluded when material.
37. **Tax-holiday high-grading:** higher-grade tonnes are accelerated into an exemption period without reflecting residual reserve quality, mine life and post-holiday effects.
38. **Sliding-scale royalty threshold distortion:** cliff/dead-zone behaviour or tier application is incorrectly modelled or not challenged.
39. **Related-party financing incentive disconnect:** fiscal relief changes debt economics but the model freezes related-party debt amount, price or tenor without rationale.
40. **ISR geology-to-production disconnect:** production is independent of permeability, hydrogeology, wellfield deployment, PLS flow/grade, chemistry or recovery.
41. **ISR mass-balance gap:** final metal cannot be reconciled through the solution-recovery process or a material missing step is filled by an undisclosed peer assumption.
42. **ISR cost-base omission:** conventional mining costs disappear but wellfield, pumping, reagent, resin, power, water treatment, monitoring or remediation costs are missing.
43. **Product-form false economy:** concentrate, cathode, pellet, DSO or beneficiated alternatives are compared on headline price instead of full recoverable net value and incremental capital/operating consequences.
44. **Polymetallic equivalent-grade rigidity:** equivalent grade/breakeven remains fixed when component price, recovery, grade, payability or royalty terms change.
45. **Resource database / QA-QC weakness hidden by a precise mine model:** financial outputs rely on mineral inventory whose sampling, assay, survey, density or QA/QC basis is materially inadequate or unverified.
46. **Bulk-density / tonnage basis mismatch:** moisture, voids, weathering, density domains or bank/loose volume conversion cause material tonnage or movement error.
47. **Dilution and mining-loss omission or double count:** reserve/feed tonnes or grades fail to apply planned/unplanned dilution and ore loss coherently, or apply them twice.
48. **Reserve reference-point mismatch:** Reserve tonnes/grade are defined at one point (e.g. in-situ, ROM, plant feed or saleable product) but the financial model treats them as another.
49. **Production schedule not operationally feasible:** tonnes, development, stripping, fleet, workforce, plant capacity or ramp-up cannot support the stated schedule.
50. **Reserve-case price basis differs from mine-plan price basis without bridge:** production schedule and Reserve statement are optimised at one price/value but DCF viability is asserted on another with no reconciliation.
51. **Valuation method does not fit mineral-property stage:** exploration property is valued primarily by a mine DCF without sufficient technical basis, or a development/producing property relies on a cost-only method despite a supportable income approach.
52. **Stale/historical mineral inventory drives value:** non-current Resource/Reserve estimates are used without explaining subsequent drilling, production, depletion or technical/economic changes.
53. **Gross in-situ metal value treated as property value:** contained metal multiplied by spot price is presented as economic value without recovery, costs, timing and modifying factors.
54. **Mining fiscal valuation-point/netback mismatch:** royalty/tax base uses the wrong physical/commercial valuation point or deducts/adds downstream costs incorrectly.
55. **Mining fiscal ring-fence mismatch:** losses, deductions or costs are pooled across projects/entities when the fiscal regime ring-fences them, or vice versa.
56. **Placer bank/loose-volume mismatch:** in-situ bank volume is used directly for equipment movement/capacity despite material swell or shrinkage.
57. **Placer mine–mill–tailings capacity mismatch:** excavation/feed, processing, oversize and tailings systems are not mutually compatible.
58. **Placer processing/environmental omission:** particle-size control, water supply/recycle, settling/tailings handling or rehabilitation materially required by the placer method is omitted.
59. **Information spent on the wrong uncertainty:** extensive drilling/testwork or model refinement targets a low-value variable while a more material geological, metallurgical or execution uncertainty remains unresolved.
60. **Mining uncertainties varied independently when physically coupled:** grade, recovery, throughput, dilution, geotechnical conditions, schedule or unit costs are sensitised separately despite material causal relationships.
61. **Scenario extremes presented as probabilities:** an all-good upside and all-bad downside are treated as likely/expected outcomes without support for the joint movements or correlations.
62. **Mining flexibility exists only in the spreadsheet:** shutdown, restart, grade change, process switch or deferral is valued without the operational, contractual, permitting, holding-cost or restart constraints needed to exercise it.
63. **Commodity price extrapolation without market basis:** a long-life mine price deck simply extends recent trend/current price without a supportable long-term market, contract or consensus rationale.
64. **Price-taking assumption fails in a thin market:** a project adds material supply to a specialty/minor/bulk product market but realised price, buyer capacity and offtake terms remain unchanged.
65. **Mining cost-curve comparison is not like-for-like:** peers use inconsistent product quality, cost boundary, by-product credits, sustaining capital, currency/base date or fiscal treatment, or an incumbent cash-cost metric is used to justify a new project's full investment economics.
66. **Mining capital source–stage mismatch:** the model assumes senior/construction-style funding for an exploration or immature project without the technical, tenure, market or execution basis required by that funding case.
67. **Reserve tail depends on speculative inventory:** scheduled repayment extends to the end of Reserve life or materially relies on Inferred Resources/exploration upside without explicit conversion risk.
68. **Mining completion assumed before operating proof:** debt service/distributions assume full completion at mechanical construction while mine access, throughput, recovery, product quality or logistics remain in ramp-up.
69. **Stream economics double count unencumbered metal:** upfront streaming proceeds are received but streamed ounces/metal are still valued at full market revenue without the contractual purchase-price burden.
70. **Mining-finance royalty missing or duplicated:** upfront royalty funding is modelled without the future royalty burden, or the same financing royalty is included twice alongside government/private royalties.
71. **Offtake prepayment double counts future sale proceeds:** prepayment is treated as revenue/funding while the same future shipment is later recognised at full unencumbered sales value or without delivery/repayment deductions.
72. **Vendor/equipment finance hides or duplicates capital recovery:** owner CAPEX and contractor unit/fixed charges both recover the same equipment cost, or the contractor payment stream omits capital recovery that the funding structure requires.
73. **Funding stack over-encumbers mine cash flow or product:** debt, streams, royalties, offtake and contractor claims are individually viable but collectively commit more product/cash flow than the mine can deliver under the same case.
74. **Scale and cut-off are optimised separately:** plant/mine size is selected first and cut-off is then forced to fill it, or vice versa, without testing the combined economic surface.
75. **Perpetual economies-of-scale assumption:** unit operating cost falls linearly with every increase in throughput despite emerging haulage, development, recovery, congestion, labour, water, power or tailings constraints.
76. **Scale sensitivity freezes capex and build time:** production rises materially while capital intensity, absolute capital, construction duration and ramp-up remain unchanged.
77. **Ore-tonne cost improvement masks metal-cost deterioration:** $/t mined or processed improves while falling grade/recovery increases the unit cost of saleable metal and reduces value.
78. **Risk premium used as a mining-risk catch-all:** a higher discount rate substitutes for explicit treatment of material geological, technical, schedule or operating risks, or duplicates risks already modelled in cash flow.
79. **Feasibility is path-dependent:** a technically detailed study optimises an inherited mining/process configuration without testing materially different economic alternatives.
80. **Shutdown economics ignore contribution and unavoidable fixed costs:** a loss-making mine is assumed to close immediately, or operate indefinitely, without separating avoidable operating costs from continuing fixed/closure/restart obligations.
81. **Investment-case value drift is unexplained:** an operating mine or committed development has materially different NPV/returns from approval but cannot bridge the change to price, geology, grade, recovery, schedule, cost, capex, fiscal or closure drivers.
82. **Resource model precision exceeds spatial support:** block grades/tonnes are used at a selective mining scale that is not supported by drilling density, domain continuity, block size or model validation.
83. **Operating forecast ignores demonstrated feasibility misses:** observed grade, throughput, recovery, utilisation, reagent/power or unit-cost underperformance is visible, but the forecast continues to use the original feasibility assumptions without a technical recovery plan.
84. **Forward curve treated as economic price forecast:** exchange futures/forwards are extended as the mine's long-term expected spot price without considering market structure or the purpose of the curve.
85. **Hedge economics double counted or physically impossible:** hedged revenue is embedded in realised price and the hedge mark-to-market is added again, or hedged tonnes/ounces exceed credible saleable production.
86. **Resource multiple is not comparable:** EV/tonne or EV/ounce peers differ materially in classification, cut-off, grade, recovery, stage, infrastructure or other economic attributes without normalisation.
87. **Earn-in headline spend overstates implied property value:** optional future exploration/development spend is capitalised as if certain and paid to the vendor, ignoring staged ownership, withdrawal rights and conditionality.
88. **Sensitivity endpoints presented as probability bounds:** a tornado/range analysis is described as P10/P50/P90 or confidence limits without probability distributions or scenario likelihood support.


## Dependency chain for mining models

Trace issues through this chain. A broken link at the top causes
cascading errors throughout.

```
Study stage + reporting basis + modifying factors → Economically mineable inventory / confidence
Geology + geotechnical + hydrology + metallurgy + infrastructure + permitting → Feasible mine/process constraints
Resource/reserve + cut-off/routing → Mine plan / production profile
Mine plan + grade/recovery → Saleable product / contained metal
Saleable product × realised price / NSR → Revenue
Production + strip/development intensity + unit costs → Mining/processing/logistics opex
Revenue → Royalties/resource levies → Net operating revenue
Revenue/opex + escalation + FX → EBITDA / operating cash flow
Mine development + plant + infrastructure + sustaining capex → Funding need / PP&E
Funding need + project stage + Reserve/technical maturity + rights/offtake/execution basis → Plausible mining-capital structure
Streams/royalties/offtake/vendor commitments → Residual project revenue, product availability and operating cash flow
Mineral-rights basis + production/reserves → Accounting amortisation / tax depletion where applicable
Accounting/tax deductions + tax-loss utilisation → Cash tax
Production/sales + payment terms + inventory policy → Working capital → terminal release
Operating cash flow - capex - tax - working capital → Project free cash flow
Project free cash flow - debt service → Equity cash flow / distributions
Debt currency + FX + interest/repayment profile → Debt service / covenant headroom
Closure/rehabilitation + residual values + working-capital release → Terminal cash flow
All project cash flows + consistent real/nominal discount rate → NPV / XNPV / project return
Equity contributions/distributions + financing terms → Equity return
```

## Mining-specific accounting and reserve-economics interfaces

These topics are included only where mining-specific treatment changes the economic
interpretation of the model. Generic financial-statement mechanics remain in the core
skill.

### Rehabilitation and closure obligations

Closure can include progressive rehabilitation during operations, final earthworks,
facility removal, water treatment, post-closure monitoring and other site-specific
obligations. Distinguish the **economic closure cash-flow schedule** from any accounting
provision/accretion mechanism. Do not require a particular funding vehicle unless the
jurisdiction, permit, bond/security arrangement or project assumption requires one.

### Mining rights, depletion and reserve revisions

Where mining/resource rights are amortised or depleted using production units, the
eligible asset basis, production numerator and relevant Reserve/resource denominator
must be coherent. Reserve revisions can change future units-of-production charges.
Accounting amortisation and jurisdiction-specific tax depletion/deductions are separate
concepts and must not be double counted.

### Stripping and mine development

Open-pit pre-stripping, production stripping and underground access/development can
have different economic and accounting treatment. The mining-domain check is that the
model distinguishes development that creates access to future ore from period mining
activity and applies a consistent treatment over the relevant component/pushback or
mine area. A change in stripping treatment must not sever the link between waste
movement, ore access and future production.

### Mining working capital and initial operating inventory

Mining working capital may include initial reagent/fuel fills, warehouse and critical
spares, drilled/broken ore, ROM/product/in-process inventories and receivables created
by shipment/payment terms. Development-phase saleable product can offset pre-
production cash requirements if it is genuinely recoverable and not counted elsewhere.
Terminal release must reconcile to final sales and stockpile depletion.

### Product-specific revenue accounting

Where the operation sells multiple products or qualities (for example PCI/thermal coal,
concentrate/by-products, ore grades or different refined products), revenue and payable
metal should preserve each product's recovery, quality, payability, pricing, penalty/
bonus and moisture/weight basis where material.

Where commodity or FX hedges are material, reconcile hedged volume by period to physically deliverable saleable production and the contractual instrument. The realised-price build should distinguish spot/benchmark exposure from hedged or contracted exposure, including premiums/discounts, option premia or settlement cash flows where material. Do not hedge more physical product than the model can credibly produce without explicitly modelling the resulting financial exposure.

## Mining contradiction patterns

Use these directional contradictions to challenge mining logic. They are not universal
threshold rules.

- **Strip ratio–cost:** materially higher waste movement with unchanged total mining effort/cost requires explanation.
- **Reserve-life:** production beyond stated Reserve life requires transparent Resource conversion, stockpile processing or extension case.
- **Yield/metal balance:** saleable product cannot exceed physically available contained/recovered product after stated recoveries and losses.
- **Royalty–value:** a value-linked royalty should move with its defined royalty base unless a threshold, cap, floor or deduction explains otherwise.
- **Cut-off–grade/tonnage:** material cut-off change should normally change tonnes and average grade.
- **Capacity–routing:** constrained plant/logistics cannot accept more material without displacement, delay, stockpiling, expansion or another response.
- **Mining method–dilution/selectivity:** changed method/geometry should not automatically retain identical dilution, loss and grade–tonnage behaviour.
- **Resource/Reserve–production:** depletion, new drilling, reclassification and stockpile movements should reconcile opening inventory to closing inventory and production where the model claims Reserve-based economics.
- **Price basis–Reserve case:** a materially different commodity-price deck should trigger explanation of whether pit/stope limits, cut-off or Reserve classification would change.
- **Workforce/equipment–schedule:** annual movement and production cannot exceed the capacities implied by the selected equipment, development access, crews and operating calendar without support.

## Domain-specific graded tests (T2-S10-097 to T2-S10-179)

This domain file intentionally begins at **T2-S10-097**. Any generic tests that may
occupy earlier IDs in the wider audit infrastructure are owned by the core skill and are
not restated here. Every test below is mining-specific and should be applied only when
its subject matter is relevant to the mine/project being reviewed.

### T2-S10-097 — test: cutoff_grade_tonnage_consistency
Where cut-off grade is an explicit input or calculated series, compare it with ore tonnes and average head grade. A materially higher cut-off should normally reduce tonnes above cut-off and increase average grade; a materially lower cut-off should normally do the reverse. If not, look for a documented change in geology, selectivity, mine plan or routing before raising an issue.

### T2-S10-098 — test: internal_external_cutoff_cost_basis
Identify whether each cut-off is being used for (a) material that must already be mined or (b) material that can remain in the ground. Confirm that unavoidable mining cost is excluded from an internal/mill routing decision where appropriate, and that incremental mining plus stripping cost is included for an external/mine decision where required. If the model uses one threshold for both situations, raise a mining-economic query or finding depending on evidence.

### T2-S10-099 — test: capacity_opportunity_cost_reflected
Where mine, plant, refining, transport or sales capacity is visibly binding, check whether the cut-off/routing logic recognises that processing an additional tonne can displace or delay scheduled material. Evidence can include a time-varying cut-off profile, opportunity-cost term, explicit stockpiling of displaced lower-grade material, or an optimisation routine that jointly solves capacity and routing. A direct-cost-only cut-off in a fully constrained system is a failure pattern unless justified.

### T2-S10-100 — test: processing_route_economic_selection
Where two or more processing destinations exist, confirm the model selects between them using route-specific economics rather than a single universal grade threshold. Compare recovery, processing cost, haulage, selling deductions and product value by route. If the model has separate destination cut-offs, test that their ordering and transitions are economically coherent.

### T2-S10-101 — test: variable_recovery_consistency
If recovery is modelled as dependent on head grade, mineral type, throughput, grind size, leach conditions or stockpile age, confirm that the recovery formula responds to those drivers. If the model materially changes one of these drivers while recovery remains static, require an explicit assumption supporting constant recovery or raise a finding/query.

### T2-S10-102 — test: polymetallic_nsr_or_value_logic
For a polymetallic deposit, confirm routing/value reflects each material revenue contributor and deduction: grades, recoveries, payabilities, commodity prices, freight/treatment/refining charges and penalties. If a metal-equivalent grade is used, confirm the factor is transparently calculated from live assumptions and changes when those assumptions change. A fixed unexplained equivalent factor is not sufficient evidence of correct ore classification.

### T2-S10-103 — test: stockpile_economics_complete
Where low-grade stockpiles are material, confirm the model distinguishes stockpiling from immediate processing and waste. Relevant economics can include current stockpiling cost, environmental/maintenance cost, future rehandling and processing, delayed revenue/discounting, recovery changes and eventual depletion of the stockpile. Do not require every item if immaterial or explicitly excluded, but a long-dated stockpile carried at immediate-processing economics is a failure pattern.

### T2-S10-104 — test: mine_plant_capacity_cutoff_interaction
Where mining capacity and plant capacity differ or are sensitised, confirm the resulting cut-off, head grade, waste/stockpile volumes and mine life respond coherently. With fixed plant capacity, a material increase in mining capacity normally requires higher cut-off and/or more stockpiling; with fixed mining capacity, a material increase in plant capacity normally requires lower cut-off and lower average feed grade unless geology/selectivity changes. Treat these as directional mining checks, not absolute rules.

### T2-S10-105 — test: selectivity_deposit_model_alignment
If the model changes mining method, bench height, stope dimensions, equipment size, dilution or ore-control practice, check whether reserve/resource conversion, grade–tonnage response and production assumptions are updated consistently. Reusing an unchanged grade–tonnage curve after a material selectivity change requires explicit justification.

### T2-S10-106 — test: sustaining_capital_in_cutoff_economics
Where continued processing depends on future sustaining capital, confirm the economic routing/cut-off analysis does not treat that required future investment as irrelevant merely because initial construction capital is sunk. Conversely, do not include historical sunk capital in a marginal operating-period routing decision unless the model is deliberately performing a full-project re-optimisation.

### T2-S10-107 — test: blend_quality_constraints_satisfied
Where blending is used, recompute the blended product quality from source tonnages and source qualities. Confirm all binding minimum/maximum product specifications and source-tonnage limits are satisfied at the chosen blend. For coal, consider calorific value, ash, sulfur, moisture and product split where relevant; for iron ore, consider Fe and deleterious elements such as silica, alumina and phosphorus where relevant.

### T2-S10-108 — test: blended_ratio_recomputed_correctly
Where a product specification is a ratio, confirm the model calculates the ratio from the blended underlying numerator and denominator quantities. Do not accept a weighted average of source ratios unless algebraically proven appropriate for that specific definition. A ratio such as silica-to-magnesia must be recomputed after blending.

### T2-S10-109 — test: mining_real_nominal_consistency
Identify the basis of the commodity-price deck, opex, capex, closure costs and discount rate. Confirm the project uses a coherent real or nominal valuation stream, with explicit conversion/escalation where bases differ. A real price deck combined with selectively inflated nominal costs and a nominal discount rate, without reconciliation, is a mining-economic failure pattern.

### T2-S10-110 — test: mining_after_tax_cashflow_structure
For a post-tax mine model, confirm the cash-flow build distinguishes economically material mining categories such as mineral rights/resource acquisition, mine development, tangible plant/equipment, sustaining capital, royalties/resource levies, working capital, tax, and closure. Do not require every category if genuinely immaterial or outside scope, but do not accept a post-tax headline return that silently omits a material mine-specific cash-flow class.

### T2-S10-111 — test: mining_depletion_basis_reserve_link
Where accounting or tax depletion/amortisation is production-based, trace the eligible asset/basis to units produced/sold and the appropriate reserve denominator. Confirm revisions to reserves propagate into the depletion rate and remaining basis. If tax depletion exists, verify it is separate from accounting amortisation and supported by the current jurisdictional tax basis.

### T2-S10-112 — test: mining_royalty_resource_levy_basis
For each material royalty or resource-linked levy, identify whether the base is gross value, netback/NSR, production units, margin/profit or a sliding scale. Recompute the charge from its stated base and confirm deductions/tier changes move correctly. A flat percentage of generic revenue is not sufficient where the governing royalty has a different basis.

### T2-S10-113 — test: mining_tax_loss_utilisation_timing
Where construction or ramp-up generates tax losses, confirm the model's cash-tax benefit occurs only when the assumed taxpayer can use those losses. Distinguish stand-alone carry-forward, group relief and ring-fenced/resource-specific treatment as applicable. An immediate cash benefit from losses with no utilisation mechanism is a failure pattern.

### T2-S10-114 — test: mining_working_capital_terminal_release
Where working capital is material, confirm inventory, receivables and payables respond to the mine's production/sales profile and unwind coherently at closure. Reconcile terminal working-capital recovery to final inventory/product sales and stockpile logic so the same material is not counted twice.

### T2-S10-115 — test: mining_fx_export_debt_consistency
Map material revenue, opex, capex, royalties/taxes and debt service by currency. In FX sensitivities, confirm both operating-margin translation and hard-currency debt/import exposure move. A scenario that changes local costs for FX but leaves hard-currency debt service or realised export revenue unchanged without justification is incomplete.

### T2-S10-116 — test: mining_alternative_evaluation_basis
When the workbook compares mutually exclusive mine plans, plant expansions, development timing or sell-versus-develop alternatives, confirm they share a common valuation date and consistent tax, currency and financing basis. Check the incremental cash-flow difference and any opportunity cost of using rather than selling owned mineral rights/assets. Do not select a preferred alternative solely from the highest standalone IRR.

### T2-S10-117 — test: mining_break_even_thresholds
Where project economics are decision-critical, check whether the model can identify at least one relevant mining break-even or reverse-stress threshold, such as realised commodity price/NSR, unit cost, recovery, capex or schedule point at which NPV reaches zero or a stated project hurdle is breached. Treat absence as a recommendation unless the model's stated purpose requires such a test.

### T2-S10-118 — test: mining_sensitivity_driver_coverage
Confirm the sensitivity set covers the mining drivers that materially control value in this project, not merely generic discount-rate or price changes. Candidate drivers include grade, recovery, throughput, ramp-up, strip ratio/development intensity, mining/processing unit costs, sustaining capital, FX, mine life and closure. Do not require irrelevant drivers; require a reasoned mapping from project risk to sensitivity variables.

### T2-S10-119 — test: mining_exploration_and_closure_risk_logic
Apply only where relevant. For exploration/staged-development cases, confirm probability-weighted economics are accompanied by the cash cost, timing and funding consequence of failure and by stop/defer/JV decision points where modelled. For producing mines with material late closure outflows, inspect cash-flow sign changes and do not rely on a single IRR/XIRR if multiple mathematical roots are possible; cross-check with NPV/XNPV at the stated hurdle rate.

### T2-S10-120 — test: mining_study_stage_evidence_maturity
Identify whether the project is concept/scoping, PFS, FS/BFS, construction or operating. Confirm the technical and cost evidence supporting the financial model is commensurate with that stage. A BFS/finance-ready model still relying on conceptual mine design, rough unadjusted peer costs or unresolved material process assumptions is a mining-domain failure pattern. Treat published accuracy ranges as context, not automatic thresholds.

### T2-S10-121 — test: mining_resource_reserve_modifying_factors
Trace the production schedule back to the disclosed resource/reserve categories and the material modifying factors used to establish economic mineability. Confirm lower-confidence resource or exploration upside is separately identified where included. If a material modifying factor changes, test whether reserve conversion, mine design and economics are revisited.

### T2-S10-122 — test: mining_feasibility_cross_discipline_consistency
Reconcile the financial model with the core feasibility disciplines. Check that mine schedule, grades/recoveries, process throughput, waste/tailings, water, power, logistics, product/offtake, permitting/ESIA, closure and execution assumptions describe the same physical project. Material inconsistency between technical studies and the economic model is a finding or unresolved query depending on evidence.

### T2-S10-123 — test: mining_cost_estimate_contingency_basis
For material CAPEX/OPEX, identify estimate source and maturity. Where contingency or probabilistic cost risk is material, check that estimate, schedule and escalation risks are not double counted and that the funding requirement reconciles to the development schedule. Do not require a fixed number of supplier quotes; require source quality proportionate to project stage and materiality.

### T2-S10-124 — test: mining_probabilistic_risk_basis
Where Monte Carlo/probabilistic analysis is used, test whether distributions/ranges are supportable, material variables are included, material correlations/dependencies are considered, and deterministic contingencies do not duplicate the same uncertainty. Review downside percentiles/tail risk in addition to mean NPV.

### T2-S10-125 — test: mining_sensitivity_reoptimisation
For sensitivities that materially change price, grade, recovery, throughput, cost or schedule, determine whether the optimal mine plan would reasonably change. If the analysis intentionally holds the mine plan static, treat it as a first-order sensitivity only. Do not accept a frozen-plan output as a fully optimised scenario when cut-off, sequencing, stockpiling, pit/stope selection or mine life would materially respond.

### T2-S10-126 — test: mining_management_flexibility_value
Apply only where strategic flexibility is material. Identify exercisable options to defer, expand, switch route/product, shut down/restart or close early after observing future conditions. Confirm the decision method reflects that flexibility where omission could change the chosen strategy. ROV is not mandatory; a transparent decision tree, adaptive scenario or other justified method can be sufficient.

### T2-S10-127 — test: mining_depleting_asset_terminal_value
For a finite-reserve mine, confirm no generic perpetual-growth or terminal-multiple value is added after the LOM unless supported by residual inventory, salvage, working-capital recovery, extension resources/reserves or a separately justified option/asset. Reconcile any terminal value to the physical mineral inventory and closure case.

### T2-S10-128 — test: mining_nav_sum_of_parts_consistency
Where NAV or sum-of-parts valuation is used, reconcile mine-asset NPVs with corporate cash, debt, investments, minority interests and corporate overhead. Confirm adjustments are not already embedded in the asset NPVs and that asset valuations use a consistent leveraged/unleveraged basis.

### T2-S10-129 — test: mining_fiscal_incentive_behavioural_response
Apply when the model evaluates a mining tax incentive. Build or inspect benchmark, direct-incentive and plausible behaviour-response cases. Challenge high-grading/production shifting, related-party sale pricing, excessive related-party interest/service charges, qualifying-capex gold plating and import-price inflation where relevant. Multiple incentives should be tested together because effects may not be additive.

### T2-S10-130 — test: mining_royalty_threshold_and_cumulative_fiscal_effect
Where royalties or resource taxes are material, confirm rate comparisons use the same base and that sliding-scale thresholds are applied correctly (incremental versus whole-base, deductions, realised-price definition). Assess whether cumulative fiscal terms materially change cut-off, reserve, production profile or mine life rather than treating tax as a passive output only.

### T2-S10-131 — test: mining_isr_process_and_mass_balance
Apply only to ISR/solution-mining projects. Trace the physical chain from hydrogeology and wellfield through PLS flow/grade, separation (SX/IX or equivalent), refining/EW and recycle to final saleable metal. Confirm production is constrained by permeability, wellfield deployment, flow, chemistry and staged recovery rather than a conventional tonnes-mined shortcut.

### T2-S10-132 — test: mining_isr_cost_and_environmental_drivers
Apply only to ISR/solution-mining projects. Confirm the model includes material wellfield CAPEX/sustaining wells, pumping, lixiviants/oxidants/resin, power, water treatment/monitoring and remediation/closure costs. Test that reagent and energy costs respond to the underlying production/recovery assumptions and hydrogeological constraints where material.

### T2-S10-133 — test: mining_polymetallic_and_product_form_value
For polymetallic/deep-sea or alternative-product-form cases, confirm multi-metal value uses live grades, recoveries, prices and royalties and that product alternatives reflect payability, TC/RC, freight, penalties, incremental processing CAPEX/OPEX and energy. A fixed equivalent-grade factor or headline price comparison is insufficient where the economic relationships change by scenario.

### T2-S10-134 — test: mining_resource_database_qaqc_support
Where Resource/Reserve integrity is material to the model purpose and supporting technical evidence is available, confirm the mineral inventory is supported by appropriate sampling/assay/survey data, QA/QC and data verification for its stated confidence. Challenge material reliance on unvalidated historical data, unresolved QA/QC failures or unexplained exclusions. Do not attempt to recreate the full Resource estimate inside the financial-model review.

### T2-S10-135 — test: mining_bulk_density_and_tonnage_basis
Check that tonnage/volume conversions use a density basis appropriate to the material and stated moisture/void condition. Where density varies materially by lithology, weathering, porosity or moisture, confirm the model/resource basis reflects that variability or has supportable simplifying assumptions. For placer/bulk-volume models, also distinguish bank from loose volume where swell/shrinkage affects movement.

### T2-S10-136 — test: mining_dilution_mining_loss_reserve_bridge
Trace in-situ Resource/Reserve tonnes and grade to mined/ROM/plant-feed quantities. Confirm planned/unplanned dilution and mining/ore losses are applied at the correct stage, distinguish them from metallurgical recovery, and are not omitted or double counted. Reconcile the resulting contained metal/product to the production schedule.

### T2-S10-137 — test: mining_reserve_reference_point_and_category
Identify the stated Reserve reference point and category. Confirm the financial model interprets tonnes/grade at the same physical point and does not silently convert Inferred or other lower-confidence material into Reserve. If strategic/upside cases include non-Reserve inventory, require clear separation from the Reserve economic case.

### T2-S10-138 — test: mining_production_schedule_operational_feasibility
Test whether annual ore/waste movement, underground development, processing throughput and ramp-up are supportable by mine sequence/access, equipment/fleet or contractor capacity, workforce/operating calendar, haulage/shaft constraints, plant availability and waste/tailings handling. A schedule that only respects plant nameplate but breaches another mining constraint is not physically demonstrated.

### T2-S10-139 — test: mining_price_basis_reserve_case_consistency
Identify the commodity/product prices and FX used for Resource/Reserve definition, mine-plan optimisation and DCF valuation. Where the economic base case differs from the Reserve-design price/value assumptions, require the reason and a bridge/cross-check showing the DCF outcome at the Reserve basis. Confirm downside price sensitivity is meaningful for the stated decision.

### T2-S10-140 — test: mining_mineral_property_valuation_method_fit
Where a mineral property is being valued, classify it broadly as exploration, Mineral Resource, development or production stage and assess whether the chosen valuation approach is supportable for that maturity. Exploration properties should not be given a fully deterministic mine DCF without adequate technical basis; development/production properties should not rely solely on historical exploration cost when supportable income economics exist. Reconcile multiple supportable approaches where used.

### T2-S10-141 — test: mining_valuation_uses_current_mineral_inventory
For mineral-property valuation, confirm the Resource/Reserve estimate used is current enough for the valuation date or that historical/non-current estimates are explicitly reconciled for subsequent drilling, mining depletion, production reconciliation, reclassification and material technical/economic changes. Stale inventory should not silently drive current value.

### T2-S10-142 — test: mining_fiscal_valuation_point_netback
For each material mining royalty/tax whose base depends on a valuation point, identify that point and recompute the price/base using only allowable downstream deductions such as transport, treatment or refining. Confirm mine-mouth/plant-gate/FOB/sale-point concepts are not mixed and related-party pricing is treated consistently with the assumed fiscal basis.

### T2-S10-143 — test: mining_fiscal_ringfence_and_loss_treatment
Where mine/project fiscal ring-fencing is material, confirm exploration/development losses, interest, rehabilitation and other deductions can be used only by the entities/projects and in the periods permitted by the assumed fiscal regime. A tax shield created by pooling ring-fenced losses across unrelated mines/projects is a failure pattern unless explicitly supported.

### T2-S10-144 — test: mining_fiscal_government_take_marginality_progressivity
Apply only to fiscal-regime/government-revenue analysis. Confirm the model distinguishes total government revenue from project economics and, where decision-useful, can evaluate average government take, marginal/breakeven burden and progressivity across profitability cases. Do not treat one headline government-take percentage as sufficient evidence that the regime is neutral, competitive or sustainable.

### T2-S10-145 — test: mining_placer_bank_loose_volume_capacity
Apply only to placer/unconsolidated bulk-volume operations. Reconcile bank/in-situ volume to loose excavated volume using project-supported swell/shrinkage assumptions where material, and size excavation/haulage/feed capacity on the correct volume basis. Check that daily/annual movement respects equipment and operating-season constraints.

### T2-S10-146 — test: mining_placer_processing_water_tailings
Apply only to placer operations. Confirm the process flow includes appropriate particle-size control and a material balance for feed, concentrate, oversize and tailings, and that water supply/recycle/pumping, settling/tailings handling and reclamation capacity support the planned throughput. Missing supplemental systems that are required for continuous operation are mining-domain omissions.

### T2-S10-147 — test: mining_reserve_stockpile_reconciliation
Where stockpiles are material, reconcile opening surveyed/estimated stockpile tonnes and grade, additions from mining, reclaim to plant, losses/adjustments and closing balance. Confirm stockpile cut-off/value uses the correct go-forward cost basis and selling deductions and does not reapply dilution/mining losses already embedded in stockpile balances.

### T2-S10-148 — test: mining_gross_in_situ_value_not_property_value
Where contained-metal or gross in-situ value is shown, confirm it is labelled only as a physical/context metric and is not used as the primary mineral-property value. An economic valuation must reflect the applicable Resource/Reserve confidence, recovery, mine/process costs, capital, timing, taxes/royalties, closure and other modifying factors.

### T2-S10-149 — test: mining_value_of_additional_information
Where material project uncertainty could be reduced before the next irreversible mining commitment, identify the drilling, testwork or technical study proposed and the decision it could change. Confirm the information targets a material uncertainty and that its cost/delay is proportionate to the plausible downside avoided or upside unlocked. Do not require formal EVPI mathematics where a qualitative mining decision test is sufficient.

### T2-S10-150 — test: mining_cost_curve_and_byproduct_normalisation
Where industry cost curves or peer unit costs support a mining decision, normalise product form/quality, cost boundary, TC/RC/freight, by-product credits, sustaining capital, currency/base date and fiscal treatment. Distinguish an incumbent producer's go-forward cash cost from a new project's full capital-recovery economics. Challenge unit costs that appear artificially low because volatile by-product credits dominate the denominator or cost offset.

### T2-S10-151 — test: mining_commodity_cycle_and_development_timing
Where commodity cyclicality and development timing are material, test whether the price deck and first-production timing have a supportable long-term basis and whether a genuine defer/accelerate option could change value. Do not assume a recent trend persists indefinitely or that management can perfectly time a future price cycle.

### T2-S10-152 — test: mining_scenario_probability_coherence
For mining upside/downside, scenario or probabilistic analysis, confirm joint movements are physically and commercially coherent. A deterministic base case is not automatically an expected value; all-good/all-bad combinations should not be assigned decision weight without support for their probability/correlation. Where material, preserve dependencies among grade, recovery, throughput, costs, schedule, price and FX.

### T2-S10-153 — test: mining_geological_technical_uncertainty_propagation
Trace material geological or technical uncertainty through the downstream mine economics. Examples include grade/continuity into production and unit cost, geotechnical conditions into dilution/support/schedule, hydrogeology into dewatering/power/access, and mineralogy into recovery/reagent/product quality. A sensitivity that changes the upstream uncertainty while freezing materially dependent downstream quantities is incomplete unless explicitly framed as a first-order test.

### T2-S10-154 — test: mining_operational_flexibility_exercisability
Where value depends on shutdown/restart, care-and-maintenance, grade switching, process-route switching or production-rate flexibility, confirm the mine can actually exercise the option. Include material holding costs, restart cost/time, workforce/contractor effects, infrastructure and take-or-pay commitments, stockpiles, licences/permits and physical mine/process constraints. Spreadsheet flexibility without operational executability is not real option value.

### T2-S10-155 — test: mining_market_absorption_and_price_taker
Where the project sells into a thin, specialty, industrial-mineral, minor-metal or otherwise capacity-constrained market, compare planned saleable output with realistic buyer/offtake capacity and test whether realised price/discounts can remain independent of project volume. For deep liquid commodity markets, document why price-taking is reasonable rather than forcing an unnecessary market-impact assumption.

### T2-S10-156 — test: mining_capital_source_stage_fit
Apply when the model assumes a material funding source. Compare that source with the mine's development stage and technical/commercial maturity. Challenge construction/project-style debt that depends on unresolved Resource/Reserve, mine/process design, licences, market/offtake, infrastructure or execution evidence. Conversely, do not require debt for an early-stage project that is appropriately funded with risk capital or a staged farm-in.

### T2-S10-157 — test: mining_reserve_tail_and_financing_horizon
Where repayment or fixed funding commitments depend on mine cash flow, map the final scheduled repayment/commitment against the Reserve-based production schedule. Confirm a supportable operating cushion remains after repayment or that any extension case is explicit. Do not apply a fixed reserve-tail percentage; challenge material reliance on Inferred Resources, exploration upside or unapproved extensions as if they were Reserve.

### T2-S10-158 — test: mining_completion_and_rampup_bankability
For development finance cases, distinguish physical construction completion from mining/processing operating completion. Check whether ore access, throughput, availability, recovery, product quality, logistics and relevant permits support the point at which the model assumes normal debt service, distributions or refinancing. A model that jumps directly from construction end to fully proven steady-state performance is incomplete where ramp-up risk is material.

### T2-S10-159 — test: mining_streaming_economic_treatment
Where streaming finance exists, trace the streamed metal percentage/quantity and contractual purchase price through the mine production and revenue schedule. Reconcile upfront stream proceeds to future delivery obligations and confirm streamed metal is not also valued as fully unencumbered market-price production. Where the stream affects marginal value, consider its effect on cut-off, mine life and residual project value.

### T2-S10-160 — test: mining_royalty_finance_economic_treatment
Where upfront capital is exchanged for a project royalty, identify the financing royalty separately from government and other private royalties, determine its base and term, and recompute its future cash-flow burden. Confirm the model does not omit the royalty after recognising the funding proceeds or duplicate it in multiple schedules. Where material, challenge the effect on marginal ore economics and Reserve/mine life.

### T2-S10-161 — test: mining_offtake_prepayment_delivery_economics
Where offtake/prepayment finance exists, reconcile prepayment cash to the future tonnes/metal, quality, delivery point and pricing formula that settle the obligation. Confirm future shipments are reduced/settled according to the contract rather than counted again at full unencumbered sale proceeds, and check that committed volume does not exceed realistic production after losses, specifications and other product commitments.

### T2-S10-162 — test: mining_vendor_equipment_finance_cost_boundary
Where a mining/processing contractor or equipment supplier finances plant or fleet, identify how capital is recovered through fixed charges, unit rates, lease/instalment payments or profit share. Reconcile this with owner CAPEX so the same asset is not funded twice. Check that contract duration, minimum payments and equipment capacity are consistent with the Reserve life, production schedule and downside/early-closure cases.

### T2-S10-163 — test: mining_funding_stack_encumbrance_reconciliation
Where multiple mining-capital instruments coexist, map debt service, streaming deliveries, financing royalties, offtake commitments and contractor capital-recovery charges to the same production/cash-flow schedule. Confirm claims do not over-encumber the same ounces/tonnes, receivables or residual cash flow and calculate the residual economics after all commitments, not instrument-by-instrument only.

### T2-S10-164 — test: mining_financeability_physical_due_diligence
Apply when the model is presented as financeable/bankable or supports a capital decision. Confirm the financing case is grounded in the material mining facts: tenure/surface rights, Resource/Reserve and mine plan, processing, water/power, waste/tailings, logistics, product market/offtake, permitting/environment/community/closure, execution/ramp-up and capable counterparties. If a decision-critical site-specific assumption cannot be verified from available evidence, record a limitation or request evidence rather than assuming the financial model proves it.

### T2-S10-165 — test: mining_joint_cutoff_scale_optimisation
Where production scale is a material design variable, test a coherent range of scale and cut-off combinations rather than validating them independently. Recalculate the associated head grade, tonnes, recovery, mine life, stockpiles, opex, capex and NPV/value metric. Confirm the selected case is supportable relative to the economically attractive envelope and document the physical, permitting, market or capital constraint where the value-maximising case is not feasible.

### T2-S10-166 — test: mining_scale_capital_and_construction_response
For material scale changes, confirm absolute CAPEX, capital intensity, infrastructure, construction duration and ramp-up respond to the proposed capacity. Challenge a sensitivity that scales tonnes/revenue without changing the capital and schedule required to build and commission that capacity. Do not impose a universal scaling exponent; require a project-supported relationship.

### T2-S10-167 — test: mining_nonlinear_cost_and_diseconomies
Where mine or plant rate changes materially, test whether the model's cost response is supportable across the production range. Look for diminishing returns or bottleneck-driven cost escalation in haulage, development, fleet, labour, ventilation, dewatering, maintenance, power, recovery, tailings or other relevant systems. A constant or perpetually declining unit cost requires evidence when the scale change is large.

### T2-S10-168 — test: mining_ore_vs_metal_unit_cost_reconciliation
When cut-off, grade, dilution, throughput or recovery changes, reconcile unit cost per ore tonne with unit cost per recovered/saleable metal or product. Confirm claimed productivity/cost improvement is not created by a denominator that ignores lower grade, recovery or quality. Trace tonnes × grade × recovery to the saleable-metal denominator.

### T2-S10-169 — test: mining_shutdown_contribution_economics
Apply to care-and-maintenance, shutdown or marginal-operation decisions. Separate avoidable variable/go-forward costs from fixed commitments that continue during shutdown, and include closure, care-and-maintenance, restart and contractual costs where material. Test whether continued operation contributes positively to unavoidable costs and whether the assumed stop/restart threshold is economically and operationally supportable.

### T2-S10-170 — test: mining_risk_discount_rate_separation
Where a mining risk premium or elevated discount rate is used, identify what it is intended to represent. Confirm material geological, recovery, schedule, capex, ramp-up, permitting, water or closure risks are not hidden solely in the discount rate when they can materially change cash-flow timing/amount, and are not double counted in both cash-flow scenarios and the rate.

### T2-S10-171 — test: mining_economic_alternatives_before_design_lockin
For a material PFS/FS/BFS or major expansion, determine whether economically distinct mining/process/scale/staging alternatives were considered before the design was locked. Challenge a study that demonstrates only that one inherited case passes the hurdle rate when materially different feasible or plausibly developable alternatives could change value. Record the evidenced constraint used to reject a stronger economic alternative.

### T2-S10-172 — test: mining_project_value_tracking_bridge
Apply to operating mines and committed material developments where an original investment case exists. Bridge the approved/base NPV or value case to the current forecast by material external and internal drivers — price/FX, Resource/Reserve/grade, dilution, recovery, throughput, schedule, opex, capex, fiscal changes and closure. Confirm the bridge reconciles mathematically and explains whether value change arose from market conditions, new information or management/operating decisions.

### T2-S10-173 — test: mining_resource_model_spatial_support
Where the economic case depends materially on a block model or spatial Resource estimate, confirm the stated mining selectivity is supportable by the model's estimation domains, data density/continuity, block support and available validation. Challenge selective-grade or local-tonnage precision that exceeds the resolution of the geological model. Do not re-perform kriging; request technical evidence where the financial result depends on unsupported spatial precision.

### T2-S10-174 — test: mining_feasibility_operating_reconciliation
For commissioning or operating mines, compare demonstrated performance with the investment/feasibility basis for material grade, dilution/ore loss, mine movement/development, throughput, availability, recovery, reagent/energy intensity, unit costs, sustaining capital and ramp-up. Confirm the current forecast is rebased to actual performance or supported by a credible technical recovery plan. A forecast that silently retains disproven feasibility assumptions is a failure pattern.

### T2-S10-175 — test: mining_price_forecast_forward_curve_distinction
Identify whether each commodity-price input is an economic forecast, forward/futures price, contract price or hedge price. Confirm the model does not treat an observable forward curve as an automatically unbiased long-term spot forecast and that the selected price basis matches the purpose of the Resource/Reserve, valuation or financing case.

### T2-S10-176 — test: mining_hedge_realised_price_volume_reconciliation
Where commodity or FX hedges are material, reconcile hedged volumes and maturities to physically deliverable saleable production and the realised-price schedule. Confirm option/forward settlement cash flows, premiums and basis effects are included where material and that the hedge is not both embedded in revenue and separately added as the same mark-to-market asset/liability.

### T2-S10-177 — test: mining_comparable_resource_metric_normalisation
Where EV/Resource, EV/Reserve or another physical multiple is used, normalise comparables for classification, cut-off, grade, recovery, product form, development stage, infrastructure/jurisdiction, scale/capital intensity, timing and material co-product or other asset effects. Do not infer economic cheapness from a low contained-unit multiple without reconciling these mining differences.

### T2-S10-178 — test: mining_earnin_implied_value_conditionality
Where an earn-in/farm-in transaction is used as valuation evidence, separate vendor cash from property expenditure, map ownership earned at each stage and identify optional/mandatory future funding, withdrawal rights and milestones. Probability- or decision-adjust later stages where they are conditional; do not capitalise the full headline future spend as certain present property value.

### T2-S10-179 — test: mining_sensitivity_probability_distinction
Where sensitivity or tornado analysis is used, confirm the output is described as a response range rather than a probability distribution unless explicit probabilities support it. Do not label sensitivity endpoints P10/P50/P90, confidence limits or loss probabilities without a probabilistic basis that reflects the relevant mining-driver dependencies.

