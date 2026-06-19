/**
 * Discriminator for synthetic vs real persona fingerprints.
 *
 * Counter-measure to Bisbee variance collapse: the discriminator is
 * trained against real records (or held-out real-looking ones) so the
 * evolutionary search is pushed toward populations that match human
 * distribution, not just maximize a single fitness metric.
 *
 * PPol used a Random Forest. We ship a logistic-regression baseline
 * here; consumers can drop in a heavier model behind the same interface.
 */

import { namedLogger } from "../logger.js";
import type { BehavioralFingerprint } from "./fingerprint.js";

const log = namedLogger("@torus-oss/saga:persona-discriminator");

export interface DiscriminatorSample {
	fingerprint: BehavioralFingerprint;
	label: "real" | "synthetic";
}

export interface DiscriminatorModel {
	model_version: number;
	trained_at: string;
	feature_count: number;
	serialized_state: string;
}

export interface PersonaDiscriminator {
	train(samples: DiscriminatorSample[]): Promise<DiscriminatorModel>;
	predict(
		model: DiscriminatorModel,
		fingerprint: BehavioralFingerprint,
	): Promise<number>;
}

interface InternalState {
	feature_order: string[];
	weights: number[];
	bias: number;
}

const MODEL_VERSION = 1;

function sigmoid(z: number): number {
	if (z >= 0) {
		const ez = Math.exp(-z);
		return 1 / (1 + ez);
	}
	const ez = Math.exp(z);
	return ez / (1 + ez);
}

function vectorize(
	fp: BehavioralFingerprint,
	featureOrder: string[],
): number[] {
	return featureOrder.map((name) => {
		const v = fp.dimensions[name];
		return typeof v === "number" && Number.isFinite(v) ? v : 0;
	});
}

export class LogisticRegressionDiscriminator implements PersonaDiscriminator {
	private epochs: number;
	private learningRate: number;
	private l2: number;

	constructor(opts?: { epochs?: number; learning_rate?: number; l2?: number }) {
		this.epochs = opts?.epochs ?? 600;
		this.learningRate = opts?.learning_rate ?? 0.5;
		this.l2 = opts?.l2 ?? 0.001;
	}

	async train(samples: DiscriminatorSample[]): Promise<DiscriminatorModel> {
		if (samples.length === 0) {
			throw new Error("LogisticRegressionDiscriminator: empty training set");
		}
		const order = this.featureOrder(samples);
		const X = samples.map((s) => vectorize(s.fingerprint, order));
		const y = samples.map((s) => (s.label === "real" ? 1 : 0));
		const n = X.length;
		const d = order.length;
		const w = new Array<number>(d).fill(0);
		let b = 0;

		for (let epoch = 0; epoch < this.epochs; epoch++) {
			const grad = new Array<number>(d).fill(0);
			let gradB = 0;
			for (let i = 0; i < n; i++) {
				const xi = X[i];
				let z = b;
				for (let j = 0; j < d; j++) z += w[j] * xi[j];
				const p = sigmoid(z);
				const err = p - y[i];
				for (let j = 0; j < d; j++) grad[j] += err * xi[j];
				gradB += err;
			}
			for (let j = 0; j < d; j++) {
				const g = grad[j] / n + this.l2 * w[j];
				w[j] -= this.learningRate * g;
			}
			b -= this.learningRate * (gradB / n);
		}

		const state: InternalState = { feature_order: order, weights: w, bias: b };
		log.info("trained logistic-regression discriminator", {
			samples: n,
			features: d,
		});
		return {
			model_version: MODEL_VERSION,
			trained_at: new Date().toISOString(),
			feature_count: d,
			serialized_state: JSON.stringify(state),
		};
	}

	async predict(
		model: DiscriminatorModel,
		fingerprint: BehavioralFingerprint,
	): Promise<number> {
		const state = JSON.parse(model.serialized_state) as InternalState;
		const x = vectorize(fingerprint, state.feature_order);
		let z = state.bias;
		for (let j = 0; j < state.feature_order.length; j++)
			z += state.weights[j] * x[j];
		return sigmoid(z);
	}

	private featureOrder(samples: DiscriminatorSample[]): string[] {
		const seen = new Set<string>();
		const ordered: string[] = [];
		for (const s of samples) {
			for (const key of Object.keys(s.fingerprint.dimensions)) {
				if (!seen.has(key)) {
					seen.add(key);
					ordered.push(key);
				}
			}
		}
		ordered.sort();
		return ordered;
	}
}

/**
 * Compute ROC-AUC for a set of (prob_real, label) pairs. Standard
 * Mann-Whitney U formulation; ties contribute 0.5.
 */
export function rocAuc(
	scored: { prob_real: number; label: "real" | "synthetic" }[],
): number {
	const positives = scored.filter((s) => s.label === "real");
	const negatives = scored.filter((s) => s.label === "synthetic");
	if (positives.length === 0 || negatives.length === 0) return 0.5;
	let wins = 0;
	let ties = 0;
	for (const p of positives) {
		for (const n of negatives) {
			if (p.prob_real > n.prob_real) wins++;
			else if (p.prob_real === n.prob_real) ties++;
		}
	}
	return (wins + 0.5 * ties) / (positives.length * negatives.length);
}
