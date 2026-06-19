/**
 * Saga fixture tests for the toy customer-support example. Each fixture
 * runs end-to-end through the in-memory toy app + the deterministic agent
 * stub. Pass rate gate is 80%, matching the example harness convention.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { runTicketSaga } from "../index";

const FIXTURES_DIR = join(import.meta.dir, "..", "__fixtures__");

function passRate(result: {
	passed: { length: number }[] | unknown[];
	total_assertions: number;
}): number {
	const passed = (result.passed as unknown[]).length;
	return passed / Math.max(1, result.total_assertions);
}

describe("saga-example-tickets fixtures", () => {
	test("simple-ticket-resolution runs end-to-end", async () => {
		const result = await runTicketSaga(
			join(FIXTURES_DIR, "simple-ticket-resolution.saga.yaml"),
		);
		expect(result.events_executed).toBe(4);
		expect(result.failed).toHaveLength(0);
		expect(passRate(result)).toBeGreaterThanOrEqual(0.8);
	});

	test("escalation-flow routes to Marcus when refund > $500", async () => {
		const result = await runTicketSaga(
			join(FIXTURES_DIR, "escalation-flow.saga.yaml"),
		);
		expect(result.events_executed).toBe(5);
		expect(result.failed).toHaveLength(0);
		const escalation = result.full_log.find(
			(o) => o.effect === "EngineerEscalated",
		);
		expect(escalation).toBeDefined();
		expect(escalation?.payload.to_engineer).toBe("marcus");
	});

	test("low-confidence-classification asks for engineer help", async () => {
		const result = await runTicketSaga(
			join(FIXTURES_DIR, "low-confidence-classification.saga.yaml"),
		);
		expect(result.events_executed).toBe(3);
		const requested = result.full_log.find(
			(o) => o.effect === "EngineerApprovalRequested",
		);
		expect(requested).toBeDefined();
	});

	test("customer-follow-up-arc creates a linked follow-up ticket", async () => {
		const result = await runTicketSaga(
			join(FIXTURES_DIR, "customer-follow-up-arc.saga.yaml"),
		);
		expect(result.events_executed).toBe(6);
		expect(result.failed).toHaveLength(0);
		const tickets = result.full_log.filter((o) => o.effect === "TicketCreated");
		expect(tickets.length).toBe(2);
		const survey = result.full_log.find(
			(o) => o.effect === "SatisfactionSurveyReceived",
		);
		expect(survey?.payload.rating).toBe(5);
	});

	test("agent-misclassifies-then-corrects reclassifies after rejection", async () => {
		const result = await runTicketSaga(
			join(FIXTURES_DIR, "agent-misclassifies-then-corrects.saga.yaml"),
		);
		expect(result.events_executed).toBe(5);
		expect(result.failed).toHaveLength(0);
		const classifications = result.full_log.filter(
			(o) => o.effect === "TicketClassified",
		);
		expect(classifications.length).toBe(2);
		const approved = result.full_log.find(
			(o) => o.effect === "EngineerApproved",
		);
		expect(approved).toBeDefined();
	});
});
