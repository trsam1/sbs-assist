import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CoachStep, RecordOutcome } from './coach-plan';
import { CoachPorts, CoachRunner } from './coach-runner';

interface Pending<T> {
  resolve: (v: T) => void;
  reject: (e: Error) => void;
}

/** Ports whose speech and recording finish only when the test says so. */
function fakePorts() {
  const speaks: { text: string; p: Pending<void> }[] = [];
  const records: Pending<RecordOutcome>[] = [];
  const log: string[] = [];
  const ports: CoachPorts = {
    speak: (text) => {
      log.push(`speak:${text}`);
      return new Promise<void>((resolve, reject) => speaks.push({ text, p: { resolve, reject } }));
    },
    cancelSpeech: () => {
      log.push('cancelSpeech');
    },
    tone: () => {
      log.push('tone');
      return Promise.resolve();
    },
    record: () => {
      log.push('record');
      return new Promise<RecordOutcome>((resolve, reject) => records.push({ resolve, reject }));
    },
    cancelRecord: () => {
      log.push('cancelRecord');
    },
  };
  return { ports, speaks, records, log };
}

const speak = (text: string): CoachStep => ({ kind: 'speak', text, label: text });
const wait = (ms: number): CoachStep => ({ kind: 'wait', ms, label: 'wait' });
const flush = () => vi.advanceTimersByTimeAsync(0);

describe('CoachRunner', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs steps in order, one at a time', async () => {
    const { ports, speaks, log } = fakePorts();
    const runner = new CoachRunner(ports);
    const done = runner.run([speak('one'), wait(1000), speak('two')]);

    await flush();
    expect(log).toEqual(['speak:one']);
    speaks[0].p.resolve();
    await flush();
    expect(log).toEqual(['speak:one']); // now waiting, nothing else yet

    await vi.advanceTimersByTimeAsync(1000);
    expect(log).toEqual(['speak:one', 'speak:two']);
    speaks[1].p.resolve();
    expect(await done).toBe('done');
  });

  it('reports each step as it starts', async () => {
    const { ports, speaks } = fakePorts();
    const seen: string[] = [];
    const runner = new CoachRunner(ports, {
      onStep: (s, i, n) => seen.push(`${i + 1}/${n}:${s.kind}`),
    });
    const done = runner.run([speak('a'), speak('b')]);
    await flush();
    speaks[0].p.resolve();
    await flush();
    speaks[1].p.resolve();
    await done;
    expect(seen).toEqual(['1/2:speak', '2/2:speak']);
  });

  it('pause cancels the step and resume restarts that same step', async () => {
    const { ports, speaks, log } = fakePorts();
    const paused: boolean[] = [];
    const runner = new CoachRunner(ports, { onPausedChange: (p) => paused.push(p) });
    const done = runner.run([speak('one'), speak('two')]);
    await flush();

    runner.pause();
    await flush();
    expect(log).toContain('cancelSpeech');
    speaks[0].p.resolve(); // a late finish from the cancelled speech must not advance anything
    await flush();
    expect(log.filter((l) => l.startsWith('speak:'))).toEqual(['speak:one']);

    runner.resume();
    await flush();
    expect(log.filter((l) => l.startsWith('speak:'))).toEqual(['speak:one', 'speak:one']);
    expect(paused).toEqual([true, false]);

    speaks[1].p.resolve();
    await flush();
    speaks[2].p.resolve();
    expect(await done).toBe('done');
  });

  it('pausing a wait gives the full wait again after resume', async () => {
    const { ports } = fakePorts();
    const runner = new CoachRunner(ports);
    let finished = false;
    void runner.run([wait(1000)]).then(() => (finished = true));
    await vi.advanceTimersByTimeAsync(600);
    runner.pause();
    await vi.advanceTimersByTimeAsync(5000);
    expect(finished).toBe(false);
    runner.resume();
    await vi.advanceTimersByTimeAsync(900);
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(finished).toBe(true);
  });

  it('skip moves to the next step at once', async () => {
    const { ports, speaks, log } = fakePorts();
    const runner = new CoachRunner(ports);
    const done = runner.run([speak('one'), speak('two')]);
    await flush();
    runner.skip();
    await flush();
    expect(log).toContain('speak:two');
    speaks[1].p.resolve();
    await done;
  });

  it('skip ends a wait early', async () => {
    const { ports, log } = fakePorts();
    const runner = new CoachRunner(ports);
    const done = runner.run([wait(60_000), { kind: 'tone', label: 't' }]);
    await flush();
    runner.skip();
    await done;
    expect(log).toContain('tone');
  });

  it('repeat replays the last spoken step while the student is in a wait', async () => {
    const { ports, speaks, log } = fakePorts();
    const runner = new CoachRunner(ports);
    const done = runner.run([speak('phrase'), wait(10_000), speak('next')]);
    await flush();
    speaks[0].p.resolve();
    await flush();

    runner.repeat();
    await flush();
    expect(log.filter((l) => l === 'speak:phrase')).toHaveLength(2);
    speaks[1].p.resolve();
    await vi.advanceTimersByTimeAsync(10_000);
    speaks[2].p.resolve();
    expect(await done).toBe('done');
    expect(log).toContain('speak:next');
  });

  it('repeat during speech replays that speech', async () => {
    const { ports, speaks, log } = fakePorts();
    const runner = new CoachRunner(ports);
    void runner.run([speak('x')]);
    await flush();
    runner.repeat();
    await flush();
    expect(log.filter((l) => l === 'speak:x')).toHaveLength(2);
    speaks[1].p.resolve();
  });

  it('stop cancels speech and recording, resolves stopped, and later runs do nothing', async () => {
    const { ports, speaks, log } = fakePorts();
    const runner = new CoachRunner(ports);
    const first = runner.run([speak('one'), speak('two')]);
    await flush();
    runner.stop();
    expect(await first).toBe('stopped');
    expect(log).toContain('cancelSpeech');
    expect(log).toContain('cancelRecord');

    speaks[0].p.resolve(); // a stale callback after stop does nothing
    await flush();
    expect(log.filter((l) => l.startsWith('speak:'))).toEqual(['speak:one']);

    expect(await runner.run([speak('again')])).toBe('stopped');
    expect(log.filter((l) => l.startsWith('speak:'))).toEqual(['speak:one']);
    expect(runner.isStopped).toBe(true);
  });

  it('stop while paused ends the session', async () => {
    const { ports } = fakePorts();
    const runner = new CoachRunner(ports);
    const done = runner.run([speak('one')]);
    await flush();
    runner.pause();
    await flush();
    runner.stop();
    expect(await done).toBe('stopped');
    expect(runner.isPaused).toBe(false);
  });

  it('a speech error pauses on the same step, reports it, and resume tries again', async () => {
    const { ports, speaks, log } = fakePorts();
    const errors: string[] = [];
    const runner = new CoachRunner(ports, { onSpeechError: (e) => errors.push(e.message) });
    const done = runner.run([speak('one')]);
    await flush();

    speaks[0].p.reject(new Error('audio busy'));
    await flush();
    expect(errors).toEqual(['audio busy']);
    expect(runner.isPaused).toBe(true);

    runner.resume();
    await flush();
    expect(log.filter((l) => l === 'speak:one')).toHaveLength(2);
    speaks[1].p.resolve();
    expect(await done).toBe('done');
  });

  it('speech cancelled on purpose is not reported as an error', async () => {
    const { ports, speaks } = fakePorts();
    const errors: string[] = [];
    const runner = new CoachRunner(ports, { onSpeechError: (e) => errors.push(e.message) });
    void runner.run([speak('one')]);
    await flush();
    runner.skip();
    speaks[0].p.reject(new Error('interrupted'));
    await flush();
    expect(errors).toEqual([]);
  });

  describe('record steps', () => {
    it('keeps the outcome of the last record step', async () => {
      const { ports, records } = fakePorts();
      const runner = new CoachRunner(ports);
      const done = runner.run([{ kind: 'record', label: 'listen' }]);
      await flush();
      records[0].resolve({ kind: 'silent' });
      await done;
      expect(runner.lastOutcome).toEqual({ kind: 'silent' });
    });

    it('clears the outcome when a new record step starts', async () => {
      const { ports, records } = fakePorts();
      const runner = new CoachRunner(ports);
      let d = runner.run([{ kind: 'record', label: 'listen' }]);
      await flush();
      records[0].resolve({ kind: 'silent' });
      await d;
      d = runner.run([{ kind: 'record', label: 'listen' }]);
      await flush();
      expect(runner.lastOutcome).toBeNull();
      records[1].resolve({ kind: 'failed' });
      await d;
      expect(runner.lastOutcome).toEqual({ kind: 'failed' });
    });

    it('does not keep an outcome that arrives after the step was skipped', async () => {
      const { ports, records, log } = fakePorts();
      const runner = new CoachRunner(ports);
      const done = runner.run([{ kind: 'record', label: 'listen' }]);
      await flush();
      runner.skip();
      await done;
      expect(log).toContain('cancelRecord');
      records[0].resolve({ kind: 'failed' });
      await flush();
      expect(runner.lastOutcome).toBeNull();
    });
  });
});
