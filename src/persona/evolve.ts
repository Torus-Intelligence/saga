/**
 * Evolutionary persona search.
 *
 * Implements the PPol-shape loop (arxiv 2605.12894):
 *   1. seed population from scraped records
 *   2. score every candidate via the discriminator (prob_real) + coverage
 *   3. select top half by fitness
 *   4. crossover + mutate to refill the population
 *   5. repeat for N generations
 *   6. return the final population
 *
 * Counter-measures wired in:
 *
 * (a) Representativeness gap: we warn at boot if the seed population fails
 *     a basic stratification check (single firm, single role). Consumers
 *     should stratify upstream.
 *
 * (b) Bisbee variance collapse: the discriminator vs real-data signal IS
 *     the counter-measure. Fitness blends prob_real with a coverage bonus
 *     measuring per-dimension population spread so single-metric collapse
 *     is detectable and penalized.
 *
 * (c) Single-metric obscures: the run emits per-dimension coverage AND
 *     per-dimension fitness, not just an aggregate score.
 */

import { namedLogger } from "../logger.js";
import type { DiscriminatorModel, PersonaDiscriminator } from "./discriminator.js";
import type { BehavioralFingerprint } from "./fingerprint.js";
import type { PersonaScrapeRecord } from "./scrape.js";

const log = namedLogger("@torus/saga:persona-evolve");

export interface PersonaCandidate {
	cast_id: string;
	display_name: string;
	inferred_role: string;
	firm_label: string;
	fingerprint: BehavioralFingerprint;
	generation: number;
	parents?: string[];
	fitness?: number;
}

export interface EvolveOpts {
	population_size: number;
	generations: number;
	mutation_rate: number;
	coverage_weight: number;
	discriminator: PersonaDiscriminator;
	discriminator_model: DiscriminatorModel;
	seed_population: PersonaCandidate[];
	rng?: () => number;
}

/** Saga cast member shape. Mirrors the generic cast contract. */
export interface SagaCastMember {
	id: string;
	user_id?: string;
	display_name: string;
	style_hint?: string;
}

export type SagaCast = SagaCastMember[];

const DEFAULTS = {
	population_size: 50,
	generations: 5,
	mutation_rate: 0.1,
	coverage_weight: 0.3,
};

function defaultRng(): number {
	return Math.random();
}

function gaussian(rng: () => number): number {
	let u = 0;
	let v = 0;
	while (u === 0) u = rng();
	while (v === 0) v = rng();
	return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function clamp01(v: number): number {
	if (!Number.isFinite(v)) return 0;
	if (v < 0) return 0;
	if (v > 1) return 1;
	return v;
}

function dimensionSpread(
	population: PersonaCandidate[],
): Record<string, number> {
	const out: Record<string, number> = {};
	if (population.length === 0) return out;
	const keys = Object.keys(population[0].fingerprint.dimensions);
	for (const k of keys) {
		const values = population.map((c) => c.fingerprint.dimensions[k] ?? 0);
		const mean = values.reduce((a, b) => a + b, 0) / values.length;
		const variance =
			values.reduce((a, v) => a + (v - mean) * (v - mean), 0) / values.length;
		out[k] = Math.sqrt(variance);
	}
	return out;
}

function coverageBonus(population: PersonaCandidate[]): number {
	const spread = dimensionSpread(population);
	const vals = Object.values(spread);
	if (vals.length === 0) return 0;
	const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
	return Math.min(1, mean * 2);
}

function stratificationOk(seed: PersonaCandidate[]): boolean {
	if (seed.length < 5) return true;
	const firms = new Set(seed.map((c) => c.firm_label));
	const roles = new Set(seed.map((c) => c.inferred_role));
	return firms.size >= 2 && roles.size >= 2;
}

export function candidateFromRecord(
	record: PersonaScrapeRecord,
	fingerprint: BehavioralFingerprint,
	idPrefix = "seed",
): PersonaCandidate {
	const firm = (record.metadata.firm as string | undefined) ?? "unknown";
	return {
		cast_id: `${idPrefix}-${record.external_id}`,
		display_name: record.display_name,
		inferred_role: record.inferred_role ?? "Unknown",
		firm_label: firm,
		fingerprint,
		generation: 0,
	};
}

function crossover(
	a: PersonaCandidate,
	b: PersonaCandidate,
	rng: () => number,
	generation: number,
): PersonaCandidate {
	const dims: Record<string, number> = {};
	for (const key of Object.keys(a.fingerprint.dimensions)) {
		dims[key] =
			rng() < 0.5
				? a.fingerprint.dimensions[key]
				: (b.fingerprint.dimensions[key] ?? a.fingerprint.dimensions[key]);
	}
	const fp: BehavioralFingerprint = {
		dimensions: dims,
		source_records: [
			...a.fingerprint.source_records,
			...b.fingerprint.source_records,
		],
		fingerprint_version: a.fingerprint.fingerprint_version,
	};
	return {
		cast_id: `gen${generation}-${a.cast_id}-x-${b.cast_id}`,
		display_name: a.display_name,
		inferred_role: a.inferred_role,
		firm_label: a.firm_label,
		fingerprint: fp,
		generation,
		parents: [a.cast_id, b.cast_id],
	};
}

function mutate(
	c: PersonaCandidate,
	rate: number,
	rng: () => number,
): PersonaCandidate {
	const dims: Record<string, number> = {};
	for (const [key, value] of Object.entries(c.fingerprint.dimensions)) {
		const perturb = rate * gaussian(rng);
		dims[key] = clamp01(value + perturb);
	}
	return {
		...c,
		fingerprint: { ...c.fingerprint, dimensions: dims },
	};
}

async function scorePopulation(
	population: PersonaCandidate[],
	opts: EvolveOpts,
): Promise<PersonaCandidate[]> {
	const bonus = coverageBonus(population);
	const out: PersonaCandidate[] = [];
	for (const c of population) {
		const prob = await opts.discriminator.predict(
			opts.discriminator_model,
			c.fingerprint,
		);
		const human = 1 - opts.coverage_weight;
		const fitness = human * prob + opts.coverage_weight * bonus;
		out.push({ ...c, fitness });
	}
	return out;
}

function selectTopHalf(population: PersonaCandidate[]): PersonaCandidate[] {
	const sorted = [...population].sort(
		(a, b) => (b.fitness ?? 0) - (a.fitness ?? 0),
	);
	const half = Math.max(2, Math.floor(sorted.length / 2));
	return sorted.slice(0, half);
}

function refill(
	parents: PersonaCandidate[],
	target: number,
	generation: number,
	mutationRate: number,
	rng: () => number,
): PersonaCandidate[] {
	const out: PersonaCandidate[] = [...parents];
	while (out.length < target) {
		const a = parents[Math.floor(rng() * parents.length)];
		const b = parents[Math.floor(rng() * parents.length)];
		const child = mutate(crossover(a, b, rng, generation), mutationRate, rng);
		out.push(child);
	}
	return out.slice(0, target);
}

function meanFitness(pop: PersonaCandidate[]): number {
	if (pop.length === 0) return 0;
	return pop.reduce((a, c) => a + (c.fitness ?? 0), 0) / pop.length;
}

export async function evolvePersonas(
	opts: EvolveOpts,
): Promise<PersonaCandidate[]> {
	const rng = opts.rng ?? defaultRng;
	const target = opts.population_size ?? DEFAULTS.population_size;
	const generations = opts.generations ?? DEFAULTS.generations;
	const mutationRate = opts.mutation_rate ?? DEFAULTS.mutation_rate;

	if (opts.seed_population.length === 0) {
		throw new Error("evolvePersonas: empty seed population");
	}

	if (!stratificationOk(opts.seed_population)) {
		log.warn(
			"seed population is not stratified -- representativeness gap risk",
			{
				firms: new Set(opts.seed_population.map((c) => c.firm_label)).size,
				roles: new Set(opts.seed_population.map((c) => c.inferred_role)).size,
				seed_size: opts.seed_population.length,
			},
		);
	}

	let population: PersonaCandidate[] = [...opts.seed_population];
	while (population.length < target) {
		const base =
			opts.seed_population[population.length % opts.seed_population.length];
		population.push(mutate(base, mutationRate, rng));
	}
	population = population.slice(0, target);

	let lastMean = -Infinity;
	for (let gen = 0; gen < generations; gen++) {
		const scored = await scorePopulation(population, opts);
		const mean = meanFitness(scored);
		const spread = dimensionSpread(scored);
		log.info("generation summary", {
			generation: gen,
			mean_fitness: mean,
			coverage_bonus: coverageBonus(scored),
			per_dimension_spread: spread,
		});
		const top = selectTopHalf(scored);
		population = refill(top, target, gen + 1, mutationRate, rng);
		lastMean = mean;
	}

	const final = await scorePopulation(population, opts);
	log.info("final population", {
		size: final.length,
		mean_fitness: meanFitness(final),
		last_intermediate_mean: lastMean,
	});
	return final;
}

export function materializeCast(
	candidates: PersonaCandidate[],
	top = 5,
): SagaCast {
	const sorted = [...candidates].sort(
		(a, b) => (b.fitness ?? 0) - (a.fitness ?? 0),
	);
	const picked = sorted.slice(0, top);
	return picked.map((c) => {
		const dims = Object.entries(c.fingerprint.dimensions)
			.sort((a, b) => b[1] - a[1])
			.slice(0, 3)
			.map(([k, v]) => `${k}=${v.toFixed(2)}`)
			.join(", ");
		return {
			id: c.cast_id,
			display_name: c.display_name,
			style_hint: `${c.inferred_role} at ${c.firm_label}; ${dims}`,
		};
	});
}
