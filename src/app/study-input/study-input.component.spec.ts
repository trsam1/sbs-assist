import { TestBed, ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { StudyInputComponent } from './study-input.component';

describe('StudyInputComponent', () => {
  let fixture: ComponentFixture<StudyInputComponent>;
  let component: StudyInputComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [StudyInputComponent],
    });
    fixture = TestBed.createComponent(StudyInputComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should show the word input form', () => {
    const form = fixture.nativeElement.querySelector('form[aria-label="Word study input"]');
    expect(form).not.toBeNull();
  });

  it('should have a disabled submit button when word is empty', () => {
    const button = fixture.nativeElement.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('should enable submit button when word is entered', () => {
    component.form.controls.word.setValue('love');
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });

  it('should emit wordSubmitted with trimmed word on submit', () => {
    let emitted = '';
    component.wordSubmitted.subscribe((w: string) => (emitted = w));

    component.form.controls.word.setValue('  appointed  ');
    component.onSubmit();

    expect(emitted).toBe('appointed');
  });

  it('should show validation error when submitted empty', () => {
    component.onSubmit();
    fixture.detectChanges();

    const error = fixture.nativeElement.querySelector('#word-error');
    expect(error).not.toBeNull();
    expect(error.textContent).toContain('Please enter a word to study');
  });

  it('should not have a Strong\'s number input', () => {
    const strongsInput = fixture.nativeElement.querySelector('#strongs-input');
    expect(strongsInput).toBeNull();
  });
});
