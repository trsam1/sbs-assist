/** Styles shared by the Memorize panes (Review card, grade row, missed-word highlight, and so on). */
export const MEMORIZE_STYLES = `
      /* Review card: flowing layout, themed via Bulma CSS variables. */
      .review-card {
        cursor: pointer;
        outline: none;
      }
      .review-card:focus-visible {
        outline: 2px solid var(--bulma-link, #485fc7);
        outline-offset: 3px;
      }
      .review-text {
        text-align: left;
      }
      .learn-text {
        font-size: 1.15rem;
        line-height: 1.6;
      }
      .fill-input {
        display: inline-block;
        width: auto;
        max-width: 100%;
        height: auto;
        min-width: 4ch;
        padding: 0 0.3em;
        margin: 0 0.1em;
        font: inherit;
        text-align: center;
        vertical-align: baseline;
      }
      .learn-locked {
        opacity: 0.7;
      }
      .card-ref {
        font-size: 1.5rem;
        font-weight: 700;
      }
      .card-prompt {
        margin-top: 0.5rem;
      }
      .card-scaffold {
        margin-top: 1rem;
        font-family: var(--bulma-family-monospace, monospace);
        letter-spacing: 0.05em;
        word-break: break-word;
      }
      .card-text {
        font-size: 1.15rem;
        line-height: 1.6;
        white-space: pre-wrap;
        text-align: center;
      }
      /* Missed-word highlight: color plus underline so it is not color-only. */
      .missed-word {
        color: var(--bulma-danger, #f14668);
        font-weight: 600;
        text-decoration: underline;
        text-decoration-thickness: 2px;
      }
      .recite-words {
        white-space: normal;
      }
      .extra-word {
        font-style: italic;
        text-decoration: line-through;
        opacity: 0.8;
      }
      /* Grade row: large, full-width, bottom-anchored targets. */
      .grade-row {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 0.5rem;
      }
      .grade-row .grade-btn {
        width: 100%;
        min-height: 44px;
        font-size: 1rem;
      }
      @media (max-width: 480px) {
        .grade-row {
          position: sticky;
          bottom: 0;
          background: var(--bulma-scheme-main, #fff);
          padding: 0.5rem 0;
          z-index: 2;
        }
        .grade-row .grade-btn {
          min-height: 52px;
        }
      }
    `;
