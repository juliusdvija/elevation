/** A small modal with a progress bar and a Cancel button, for work that takes a few seconds. */
export class ProgressDialog {
  private readonly backdrop = document.createElement('div');
  private readonly stage = document.createElement('p');
  private readonly fill = document.createElement('i');

  constructor(title: string, onCancel: () => void) {
    this.backdrop.className = 'dialog-backdrop';
    const dialog = document.createElement('div');
    dialog.className = 'dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', title);
    const heading = document.createElement('h2');
    heading.textContent = title;
    this.stage.className = 'dialog-summary';
    this.stage.textContent = 'Starting…';
    const bar = document.createElement('div');
    bar.className = 'progress-bar';
    bar.append(this.fill);
    const buttons = document.createElement('div');
    buttons.className = 'dialog-buttons';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'pill-button';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => {
      this.close();
      onCancel();
    });
    buttons.append(cancel);
    dialog.append(heading, this.stage, bar, buttons);
    this.backdrop.append(dialog);
    document.body.append(this.backdrop);
  }

  update(fraction: number, stage: string): void {
    this.fill.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
    this.stage.textContent = `${stage}…`;
  }

  close(): void {
    this.backdrop.remove();
  }
}
