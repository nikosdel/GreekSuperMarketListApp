import { Language } from './language';

describe('Language quantity formatting', () => {
  beforeEach(() => {
    localStorage.removeItem('supermarket.language');
  });

  it('displays stored whole quantities without decimal places', () => {
    const language = new Language();

    expect(language.quantity('1.000')).toBe('1');
    expect(language.quantity('2.000')).toBe('2');
    expect(language.quantity(3)).toBe('3');
  });

  it('keeps whole quantity formatting in English', () => {
    const language = new Language();
    language.setLanguage('en');

    expect(language.quantity('1.000')).toBe('1');
    expect(language.quantity('2.000')).toBe('2');
  });
});
