import { TestBed, ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { StudyWorksheetComponent } from './study-worksheet.component';
import { StrongsStudyResult, CrossReference } from '../models';
import { Component, signal } from '@angular/core';
import { EnglishDictionaryResult } from '../english-definition.service';

// Test host to set inputs
@Component({
  imports: [StudyWorksheetComponent],
  template: `
    <app-study-worksheet
      [word]="word()"
      [strongsData]="strongsData()"
      [crossReferences]="crossReferences()"
      [englishDefinition]="englishDefinition()"
      [notes]="notes()"
      [aiSummary]="aiSummary()"
      [aiSummaryState]="aiSummaryState()"
      [saveState]="saveState()"
      [studyId]="studyId()"
      [viewAll]="viewAll()"
    />
  `,
})
class TestHostComponent {
  word = signal('love');
  strongsData = signal<StrongsStudyResult | null>(null);
  crossReferences = signal<CrossReference[] | null>(null);
  englishDefinition = signal<EnglishDictionaryResult | null>({
    word: 'love',
    meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'deep affection' }] }],
  });
  notes = signal<string | null>(null);
  aiSummary = signal<string | null>(null);
  aiSummaryState = signal<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  saveState = signal<'idle' | 'saving' | 'saved' | 'error'>('idle');
  studyId = signal<string | null>(null);
  viewAll = signal(false);
}

describe('StudyWorksheetComponent', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let host: TestHostComponent;

  function query(selector: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(selector);
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TestHostComponent, StudyWorksheetComponent],
    });
    fixture = TestBed.createComponent(TestHostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create and show step 1 by default', () => {
    expect(query('section[aria-label="Word study worksheet"]')).not.toBeNull();
    expect(query('[data-testid="english-definition"]')).not.toBeNull();
  });

  it('should display the English definition in step 1', () => {
    const def = query('[data-testid="english-definition"]');
    expect(def?.textContent).toContain('deep affection');
  });

  it("should show the Strong's number form in step 2", () => {
    // Navigate to step 2
    const nextBtn = query('[data-testid="step1-next"]') as HTMLButtonElement;
    nextBtn.click();
    fixture.detectChanges();

    expect(query('#strongs-input')).not.toBeNull();
    expect(query('[data-testid="strongs-submit"]')).not.toBeNull();
  });

  it('should show Save Study button', () => {
    const saveBtn = query('[data-testid="save-button"]') as HTMLButtonElement;
    expect(saveBtn).not.toBeNull();
    expect(saveBtn.textContent?.trim()).toBe('Save Study');
  });

  it('should show Update Study when studyId is set', () => {
    host.studyId.set('existing-id');
    fixture.detectChanges();

    const saveBtn = query('[data-testid="save-button"]') as HTMLButtonElement;
    expect(saveBtn.textContent?.trim()).toBe('Update Study');
  });

  it('should show general notes sidebar', () => {
    expect(query('[data-testid="general-notes"]')).not.toBeNull();
  });

  it('should show all steps when viewAll is true', () => {
    host.strongsData.set({
      strongsNumber: 'G25',
      definition: 'to love',
      originalWord: 'ἀγαπάω',
      transliteration: 'agapaō',
      lexiconEntry: 'From ἀγάπη; to love...',
    });
    host.crossReferences.set([{ reference: 'Romans 5:8', notes: '' }]);
    host.aiSummaryState.set('loaded');
    host.aiSummary.set('AI summary text');
    host.viewAll.set(true);
    fixture.detectChanges();

    // All steps should be visible
    expect(query('[data-testid="english-definition"]')).not.toBeNull();
    expect(query('[data-testid="strongs-number"]')).not.toBeNull();
    expect(query('[data-testid="strongs-lexicon-entry"]')).not.toBeNull();
    expect(query('[data-testid="cross-ref-reference"]')).not.toBeNull();
    expect(query('[data-testid="ai-summary-content"]')).not.toBeNull();
  });
});
