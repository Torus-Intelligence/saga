/**
 * SagaRecorder -- unified time-ordered observation buffer.
 *
 * Every injector pushes its observations through `record()`. Each call
 * gets a monotonic seq number and is tagged with the current event_index
 * so the verifier can group observations back to the saga event that
 * produced them.
 *
 * Deliberately dumb -- no LLM, no DB, just a typed buffer.
 */

import type { SagaObservation, SyncLog } from "./types";

export class SagaRecorder {
	private seqCounter = 0;
	private currentEventIndex = -1;
	private readonly log: SagaObservation[] = [];

	beginEvent(eventIndex: number): void {
		this.currentEventIndex = eventIndex;
	}

	record(effect: string, payload: Record<string, unknown>): SagaObservation {
		const obs: SagaObservation = {
			seq: this.seqCounter++,
			event_index: this.currentEventIndex,
			effect,
			payload,
		};
		this.log.push(obs);
		return obs;
	}

	ingest(sync: SyncLog): void {
		for (const o of sync.observations) {
			this.record(o.effect, o.payload);
		}
	}

	snapshot(): SagaObservation[] {
		return [...this.log];
	}
}
