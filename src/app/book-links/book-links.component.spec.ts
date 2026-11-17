import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { BookStudy } from '../models';
import { BookLinksComponent, toggleBook, visibleSelection } from './book-links.component';

function book(id: string, name: string, title = ''): BookStudy {
  return {
    id,
    book: name,
    title,
    notes: '',
    createdAt: '',
    updatedAt: '',
    referents: [],
    userId: 'u',
  } as BookStudy;
}

const BOOKS = [book('b1', 'Romans', 'Grace'), book('b2', 'Ephesians'), book('b3', 'Jude')];

describe('toggleBook', () => {
  it('adds a checked book and keeps the others', () => {
    expect(toggleBook(['b1'], BOOKS, 'b2', true)).toEqual(['b1', 'b2']);
  });

  it('removes an unchecked book', () => {
    expect(toggleBook(['b1', 'b2'], BOOKS, 'b1', false)).toEqual(['b2']);
  });

  it('does not duplicate a book that is already selected', () => {
    expect(toggleBook(['b1'], BOOKS, 'b1', true)).toEqual(['b1']);
  });

  it('drops ids that match no loaded book on the first change', () => {
    expect(toggleBook(['b1', 'deleted'], BOOKS, 'b2', true)).toEqual(['b1', 'b2']);
  });
});

describe('visibleSelection', () => {
  it('lists only selected ids that match a book, in book order', () => {
    expect(visibleSelection(['b3', 'gone', 'b1'], BOOKS)).toEqual(['b1', 'b3']);
  });
});

@Component({
  selector: 'app-host',
  imports: [BookLinksComponent],
  template: `<app-book-links
    [books]="books()"
    [selected]="selected()"
    (selectedChange)="selected.set($event)"
  />`,
})
class HostComponent {
  books = signal<BookStudy[]>(BOOKS);
  selected = signal<string[]>(['b1']);
}

describe('BookLinksComponent', () => {
  let host: HostComponent;
  let el: HTMLElement;
  let render: () => void;

  beforeEach(() => {
    const fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    el = fixture.nativeElement as HTMLElement;
    render = () => fixture.detectChanges();
    render();
  });

  const box = (id: string) =>
    el.querySelector(`[data-testid="book-link-${id}"]`) as HTMLInputElement;

  it('shows a checkbox per book with the selected ones checked', () => {
    expect(el.querySelectorAll('input[type="checkbox"]').length).toBe(3);
    expect(box('b1').checked).toBe(true);
    expect(box('b2').checked).toBe(false);
    expect(el.textContent).toContain('Romans');
    expect(el.textContent).toContain('Grace');
  });

  it('lets a word be linked to several books', () => {
    box('b2').click();
    render();
    box('b3').click();
    render();
    expect(host.selected()).toEqual(['b1', 'b2', 'b3']);
    expect(box('b3').checked).toBe(true);
  });

  it('unlinks a book when unchecked', () => {
    box('b1').click();
    render();
    expect(host.selected()).toEqual([]);
  });

  it('says so when there are no books', () => {
    host.books.set([]);
    render();
    expect(el.querySelector('[data-testid="book-links-empty"]')).toBeTruthy();
    expect(el.querySelectorAll('input[type="checkbox"]').length).toBe(0);
  });
});
