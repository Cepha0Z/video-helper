export class JobQueue {
  constructor(run, { limit = 3 } = {}) {
    this.run = run; this.limit = limit; this.pending = []; this.active = new Map();
  }
  add(job) {
    if (this.active.has(job.id) || this.pending.some(item => item.id === job.id)) return;
    this.pending.push(job); this.pump();
  }
  cancel(id) {
    const index = this.pending.findIndex(job => job.id === id);
    if (index !== -1) { this.pending.splice(index,1); return 'queued'; }
    if (this.active.has(id)) { this.active.get(id).abort(); return 'active'; }
    return null;
  }
  pump() {
    while (this.active.size < this.limit && this.pending.length) {
      const job = this.pending.shift(), controller = new AbortController();
      this.active.set(job.id, controller);
      Promise.resolve().then(() => this.run(job,controller.signal)).catch(() => {})
        .finally(() => {this.active.delete(job.id);this.pump();});
    }
  }
}
