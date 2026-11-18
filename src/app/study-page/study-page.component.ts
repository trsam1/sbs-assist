import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { StudyInputComponent } from '../study-input/study-input.component';
import {
  StudyWorksheetComponent,
  AiSummaryState,
  SaveState,
  CrossReferenceNoteChange,
  StrongsNumberSubmitted,
} from '../study-worksheet/study-worksheet.component';
import { StrongsLookupService } from '../strongs-lookup.service';
import { StudyCrudService } from '../study-crud.service';
import { AiSummaryService } from '../ai-summary.service';
import { EnglishDefinitionService, EnglishDictionaryResult } from '../english-definition.service';
import { BookLinksComponent } from '../book-links/book-links.component';
import { BookStudyService } from '../book-study.service';
import {
  StrongsStudyResult,
  CrossReference,
  WordStudyEntry,
  StudyWorksheet,
  BookStudy,
} from '../models';
import { forkJoin } from 'rxjs';

@Component({
  selector: 'app-study-page',
  imports: [StudyInputComponent, StudyWorksheetComponent, BookLinksComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!word() && !loading()) {
      <app-study-input (wordSubmitted)="onWordSubmitted($event)" />
    }

    @if (loading()) {
      <div class="box has-text-centered" aria-live="polite" aria-busy="true">
        <p>Loading study data…</p>
      </div>
    }

    @if (error()) {
      <div class="notification is-danger" role="alert">
        {{ error() }}
      </div>
    }

    @if (word() && !loading()) {
      @if (booksLoaded()) {
        <app-book-links
          [books]="books()"
          [selected]="bookStudyIds()"
          (selectedChange)="bookStudyIds.set($event)"
        />
      }
      <app-study-worksheet
        [word]="word()"
        [strongsNumber]="strongsNumber()"
        [strongsData]="strongsData()"
        [crossReferences]="crossReferences()"
        [englishDefinition]="englishDefinition()"
        [englishDefLoading]="englishDefLoading()"
        [englishDefStatus]="englishDefStatus()"
        (retryEnglishDefinition)="retryEnglishDefinition()"
        [strongsLoading]="strongsLoading()"
        [strongsError]="strongsError()"
        [notes]="notes()"
        [aiSummary]="aiSummary()"
        [aiSummaryState]="aiSummaryState()"
        [saveState]="saveState()"
        [studyId]="studyId()"
        [viewAll]="viewAll()"
        [step1Notes]="step1Notes()"
        [step2Notes]="step2Notes()"
        [step3Notes]="step3Notes()"
        (crossReferenceNoteChange)="onCrossRefNoteChange($event)"
        (notesChange)="onNotesChange($event)"
        (generateAiSummary)="onGenerateAiSummary()"
        (saveStudy)="onSaveStudy()"
        (strongsNumberSubmitted)="onStrongsNumberSubmitted($event)"
        (step1NotesChanged)="step1Notes.set($event)"
        (step2NotesChanged)="step2Notes.set($event)"
        (step3NotesChanged)="step3Notes.set($event)"
      />
    }
  `,
})
export class StudyPageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly strongsLookup = inject(StrongsLookupService);
  private readonly studyCrud = inject(StudyCrudService);
  private readonly aiSummaryService = inject(AiSummaryService);
  private readonly englishDef = inject(EnglishDefinitionService);
  private readonly bookStudyService = inject(BookStudyService);

  /** The student's books, for the "Books this study belongs to" control. */
  readonly books = signal<BookStudy[]>([]);
  /** False until the book list loads; stays false if it fails, which hides the control (links are kept). */
  readonly booksLoaded = signal(false);
  /** Every linked book id, including ones that match no loaded book (kept until the selection changes). */
  readonly bookStudyIds = signal<string[]>([]);

  readonly word = signal('');
  readonly strongsNumber = signal<string | null>(null);
  readonly strongsData = signal<StrongsStudyResult | null>(null);
  readonly crossReferences = signal<CrossReference[] | null>(null);
  readonly englishDefinition = signal<EnglishDictionaryResult | null>(null);
  readonly englishDefLoading = signal(false);
  readonly englishDefStatus = signal<'idle' | 'found' | 'not-found' | 'error'>('idle');
  readonly strongsLoading = signal(false);
  readonly strongsError = signal<string | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly notes = signal<string | null>(null);
  readonly aiSummary = signal<string | null>(null);
  readonly aiSummaryState = signal<AiSummaryState>('idle');
  readonly saveState = signal<SaveState>('idle');
  readonly studyId = signal<string | null>(null);
  readonly viewAll = signal(false);

  // Per-step notes
  readonly step1Notes = signal('');
  readonly step2Notes = signal('');
  readonly step3Notes = signal('');

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('studyId');
    // Started from a book's "Add word study" button: begin linked to that book.
    const fromBook = this.route.snapshot.queryParamMap?.get('bookStudyId') ?? '';
    if (!id && fromBook) {
      this.bookStudyIds.set([fromBook]);
    }
    this.loadBooks();
    if (id) {
      this.loadStudy(id);
    }
  }

  /** Non-blocking. A failure leaves the control hidden; the study's existing links still save. */
  private loadBooks(): void {
    this.bookStudyService.list().subscribe({
      next: (books) => {
        this.books.set(books);
        this.booksLoaded.set(true);
      },
      error: () => {
        this.booksLoaded.set(false);
      },
    });
  }

  onWordSubmitted(word: string): void {
    this.word.set(word);
    this.lookUpEnglish(word);
  }

  /** Try the dictionary again for the word on the page (after a failure, or for an old saved study). */
  retryEnglishDefinition(): void {
    const word = this.word();
    if (word) this.lookUpEnglish(word);
  }

  private lookUpEnglish(word: string): void {
    this.englishDefLoading.set(true);
    this.englishDef.lookupEnglishDefinition(word).subscribe((lookup) => {
      this.englishDefStatus.set(lookup.status);
      this.englishDefinition.set(lookup.status === 'found' ? lookup.result : null);
      this.englishDefLoading.set(false);
    });
  }

  onStrongsNumberSubmitted(event: StrongsNumberSubmitted): void {
    this.strongsNumber.set(event.strongsNumber);
    this.strongsLoading.set(true);
    this.strongsError.set(null);
    this.strongsData.set(null);
    this.crossReferences.set(null);

    forkJoin({
      strongs: this.strongsLookup.getStrongsStudyData(event.strongsNumber),
      crossRefs: this.strongsLookup.getCrossReferences(event.strongsNumber),
    }).subscribe({
      next: ({ strongs, crossRefs }) => {
        this.strongsData.set(strongs);
        this.crossReferences.set(crossRefs);
        this.strongsLoading.set(false);
      },
      error: () => {
        this.strongsError.set("Failed to load Strong's data. Please try again.");
        this.strongsLoading.set(false);
      },
    });
  }

  onCrossRefNoteChange(change: CrossReferenceNoteChange): void {
    const refs = this.crossReferences();
    if (!refs) return;
    const updated = refs.map((ref, i) =>
      i === change.index ? { ...ref, notes: change.notes } : ref,
    );
    this.crossReferences.set(updated);
  }

  onNotesChange(value: string): void {
    this.notes.set(value);
  }

  onGenerateAiSummary(): void {
    const sd = this.strongsData();
    if (!sd) return;

    this.aiSummaryState.set('loading');

    const entry: WordStudyEntry = {
      word: this.word(),
      strongsNumber: this.strongsNumber() ?? '',
      englishDefinition: this.englishDefinition() ?? null,
      strongsDefinition: sd.definition,
      originalWord: sd.originalWord,
      transliteration: sd.transliteration,
      lexiconEntry: sd.lexiconEntry,
      crossReferences: this.crossReferences() ?? [],
      aiSummary: '',
      notes: this.notes() ?? '',
      definitionNotes: this.step1Notes(),
      strongsNotes: this.step2Notes(),
      lexiconNotes: this.step3Notes(),
    };

    this.aiSummaryService.generateSummary(entry).subscribe({
      next: (summary) => {
        this.aiSummary.set(summary);
        this.aiSummaryState.set('loaded');
      },
      error: () => {
        this.aiSummaryState.set('error');
      },
    });
  }

  onSaveStudy(): void {
    this.saveState.set('saving');

    const entry: WordStudyEntry = {
      word: this.word(),
      strongsNumber: this.strongsNumber() ?? '',
      englishDefinition: this.englishDefinition() ?? null,
      strongsDefinition: this.strongsData()?.definition ?? '',
      originalWord: this.strongsData()?.originalWord ?? '',
      transliteration: this.strongsData()?.transliteration ?? '',
      lexiconEntry: this.strongsData()?.lexiconEntry ?? '',
      crossReferences: this.crossReferences() ?? [],
      aiSummary: this.aiSummary() ?? '',
      notes: this.notes() ?? '',
      definitionNotes: this.step1Notes(),
      strongsNotes: this.step2Notes(),
      lexiconNotes: this.step3Notes(),
    };

    const worksheet: StudyWorksheet = {
      id: this.studyId() ?? '',
      userId: '',
      createdAt: '',
      updatedAt: '',
      wordStudies: [entry],
      bookStudyIds: this.bookStudyIds(),
    };

    this.studyCrud.saveStudy(worksheet).subscribe({
      next: (id) => {
        this.studyId.set(id);
        this.saveState.set('saved');
      },
      error: () => {
        this.saveState.set('error');
      },
    });
  }

  loadStudy(studyId: string): void {
    this.loading.set(true);
    this.error.set(null);

    this.studyCrud.getStudy(studyId).subscribe({
      next: (worksheet) => {
        const entry = worksheet.wordStudies[0];
        if (!entry) {
          this.error.set('Saved study has no word study entries.');
          this.loading.set(false);
          return;
        }

        this.word.set(entry.word);
        this.strongsNumber.set(entry.strongsNumber || null);
        this.englishDefinition.set(entry.englishDefinition);
        this.notes.set(entry.notes);
        this.studyId.set(worksheet.id);
        this.bookStudyIds.set(worksheet.bookStudyIds ?? []);
        this.step1Notes.set(entry.definitionNotes ?? '');
        this.step2Notes.set(entry.strongsNotes ?? '');
        this.step3Notes.set(entry.lexiconNotes ?? '');

        if (entry.strongsNumber) {
          this.viewAll.set(true);

          this.strongsData.set({
            strongsNumber: entry.strongsNumber,
            definition: entry.strongsDefinition,
            originalWord: entry.originalWord,
            transliteration: entry.transliteration,
            lexiconEntry: entry.lexiconEntry,
          });

          this.crossReferences.set(entry.crossReferences);

          if (entry.aiSummary) {
            this.aiSummary.set(entry.aiSummary);
            this.aiSummaryState.set('loaded');
          }
        }

        this.loading.set(false);
      },
      error: () => {
        this.error.set('Failed to load saved study. Please try again.');
        this.loading.set(false);
      },
    });
  }
}
