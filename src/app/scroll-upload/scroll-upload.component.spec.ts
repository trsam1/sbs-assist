import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { ScrollUploadComponent } from './scroll-upload.component';
import { ScrollStudyService } from '../scroll-study.service';

function makeFile(name: string, type = 'application/pdf', size = 1024): File {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

describe('ScrollUploadComponent', () => {
  let fixture: ComponentFixture<ScrollUploadComponent>;
  let component: ScrollUploadComponent;
  let createSpy: ReturnType<typeof vi.fn>;
  let uploadSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    createSpy = vi.fn();
    uploadSpy = vi.fn();
    const mockService: Partial<ScrollStudyService> = {
      createScrollStudy: createSpy as unknown as ScrollStudyService['createScrollStudy'],
      uploadBytes: uploadSpy as unknown as ScrollStudyService['uploadBytes'],
    };

    await TestBed.configureTestingModule({
      imports: [ScrollUploadComponent],
      providers: [provideRouter([]), { provide: ScrollStudyService, useValue: mockService }],
    }).compileComponents();

    fixture = TestBed.createComponent(ScrollUploadComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  function query(selector: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(selector);
  }

  function selectFile(file: File | null): void {
    const target = { files: file ? [file] : [] } as unknown as HTMLInputElement;
    component.onFileSelected({ target } as unknown as Event);
    fixture.detectChanges();
  }

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('rejects a disallowed extension and does not call createScrollStudy', () => {
    component.form.controls.bookName.setValue('Genesis');
    selectFile(makeFile('book.doc'));

    expect(query('[data-testid="file-error"]')).not.toBeNull();

    component.onSubmit();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('rejects a file larger than 10 MB and does not call createScrollStudy', () => {
    component.form.controls.bookName.setValue('Genesis');
    selectFile(makeFile('book.pdf', 'application/pdf', 11 * 1024 * 1024));

    expect(query('[data-testid="file-error"]')).not.toBeNull();

    component.onSubmit();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('does not submit without a book name', () => {
    selectFile(makeFile('book.pdf'));
    component.onSubmit();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('creates, uploads, and navigates on success', () => {
    createSpy.mockReturnValue(
      of({ scrollStudyId: 's1', uploadUrl: 'https://s3/put', objectKey: 'uploads/u1/s1.pdf' }),
    );
    uploadSpy.mockReturnValue(of(undefined));
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate');

    component.form.controls.bookName.setValue('Genesis');
    selectFile(makeFile('genesis.pdf'));
    component.onSubmit();

    expect(createSpy).toHaveBeenCalledWith({
      bookName: 'Genesis',
      filename: 'genesis.pdf',
      contentType: 'application/pdf',
    });
    expect(uploadSpy).toHaveBeenCalledWith('https://s3/put', expect.any(File));
    expect(navigateSpy).toHaveBeenCalledWith(['/scroll', 's1']);
  });

  it('shows an error and keeps the book name when the create request fails', () => {
    createSpy.mockReturnValue(throwError(() => new Error('boom')));

    component.form.controls.bookName.setValue('Exodus');
    selectFile(makeFile('exodus.pdf'));
    component.onSubmit();
    fixture.detectChanges();

    expect(component.state()).toBe('error');
    expect(query('[data-testid="upload-error"]')).not.toBeNull();
    expect(component.form.controls.bookName.value).toBe('Exodus');
  });

  it('shows an error and keeps the book name when the S3 upload fails', () => {
    createSpy.mockReturnValue(
      of({ scrollStudyId: 's1', uploadUrl: 'https://s3/put', objectKey: 'uploads/u1/s1.pdf' }),
    );
    uploadSpy.mockReturnValue(throwError(() => new Error('network')));

    component.form.controls.bookName.setValue('Leviticus');
    selectFile(makeFile('lev.pdf'));
    component.onSubmit();
    fixture.detectChanges();

    expect(component.state()).toBe('error');
    expect(query('[data-testid="upload-error"]')).not.toBeNull();
    expect(component.form.controls.bookName.value).toBe('Leviticus');
  });
});
