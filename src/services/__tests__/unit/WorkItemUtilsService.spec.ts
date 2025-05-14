// File: src/services/__tests__/unit/WorkItemUtilsService.spec.ts
import { WorkItemUtilsService } from '../../WorkItemUtilsService.js'; // This import should now work

describe('WorkItemUtilsService Unit Tests', () => {
  // No instance 'utilsService' is needed as calculateOrderKey is static.
  // beforeAll can be removed if no setup is required for static calls.

  describe('calculateOrderKey', () => {
    it('should return a default key for an empty list', () => {
      const key = WorkItemUtilsService.calculateOrderKey(null, null);
      expect(key).toBe('1000');
    });

    it('should return a key before the first item', () => {
      const key = WorkItemUtilsService.calculateOrderKey(null, '500');
      expect(key).toBe('499');
    });

    it('should return a key before the first item (negative result)', () => {
      const key = WorkItemUtilsService.calculateOrderKey(null, '0');
      expect(key).toBe('-1');
    });

    it('should return a key before the first item (fractional)', () => {
      const key = WorkItemUtilsService.calculateOrderKey(null, '0.5');
      expect(key).toBe('-0.5');
    });

    it('should return a key after the last item', () => {
      const key = WorkItemUtilsService.calculateOrderKey('2000', null);
      expect(key).toBe('2001');
    });

    it('should return a key after the last item (negative start)', () => {
      const key = WorkItemUtilsService.calculateOrderKey('-5', null);
      expect(key).toBe('-4');
    });

    it('should return a key after the last item (fractional start)', () => {
      const key = WorkItemUtilsService.calculateOrderKey('99.5', null);
      expect(key).toBe('100.5');
    });

    it('should return a key between two integer keys', () => {
      const key = WorkItemUtilsService.calculateOrderKey('100', '200');
      expect(key).toBe('150');
    });

    it('should return a key between two fractional keys', () => {
      const key = WorkItemUtilsService.calculateOrderKey('10.5', '11.5');
      expect(key).toBe('11');
    });

    it('should return a key between a negative and positive key', () => {
      const key = WorkItemUtilsService.calculateOrderKey('-10', '10');
      expect(key).toBe('0');
    });

    it('should return a key between two close fractional keys', () => {
      const key = WorkItemUtilsService.calculateOrderKey('10.125', '10.25');
      expect(key).toBe('10.1875');
    });

    it('should return the average even if keys are identical', () => {
      const key = WorkItemUtilsService.calculateOrderKey('150', '150');
      expect(key).toBe('150');
    });

    it('should return the average even if keyBefore > keyAfter', () => {
      const key = WorkItemUtilsService.calculateOrderKey('200', '100');
      expect(key).toBe('150');
    });

    it('should handle averaging resulting in a non-distinct key (precision loss simulation)', () => {
      const numBefore = 1;
      const numAfter = 1 + Number.EPSILON / 2;
      const key = WorkItemUtilsService.calculateOrderKey(String(numBefore), String(numAfter));
      expect(key).toBe('1');
    });

    it('should return null for invalid keyBefore input', () => {
      const key = WorkItemUtilsService.calculateOrderKey('not-a-number', '100');
      expect(key).toBeNull();
    });

    it('should return null for invalid keyAfter input', () => {
      const key = WorkItemUtilsService.calculateOrderKey('100', 'not-a-number');
      expect(key).toBeNull();
    });
  });
});
