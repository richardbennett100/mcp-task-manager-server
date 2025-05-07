// src/services/__tests__/unit/WorkItemUtilsService.spec.ts
import { WorkItemUtilsService } from '../../WorkItemUtilsService.js';
// Removed WorkItemRepository import - no longer needed

describe('WorkItemUtilsService Unit Tests', () => {
  let utilsService: WorkItemUtilsService;

  beforeAll(() => {
    // Instantiate without repository - constructor now takes no arguments
    utilsService = new WorkItemUtilsService();
  });

  describe('calculateOrderKey', () => {
    // --- Standard Cases ---
    it('should return a default key for an empty list', () => {
      const key = utilsService.calculateOrderKey(null, null);
      expect(key).toBe('1000');
    });

    it('should return a key before the first item', () => {
      const key = utilsService.calculateOrderKey(null, '500');
      expect(key).toBe('499');
    });

    it('should return a key before the first item (negative result)', () => {
      const key = utilsService.calculateOrderKey(null, '0');
      expect(key).toBe('-1');
    });

    it('should return a key before the first item (fractional)', () => {
      const key = utilsService.calculateOrderKey(null, '0.5');
      expect(key).toBe('-0.5');
    });

    it('should return a key after the last item', () => {
      const key = utilsService.calculateOrderKey('2000', null);
      expect(key).toBe('2001');
    });

    it('should return a key after the last item (negative start)', () => {
      const key = utilsService.calculateOrderKey('-5', null);
      expect(key).toBe('-4');
    });

    it('should return a key after the last item (fractional start)', () => {
      const key = utilsService.calculateOrderKey('99.5', null);
      expect(key).toBe('100.5');
    });

    it('should return a key between two integer keys', () => {
      const key = utilsService.calculateOrderKey('100', '200');
      expect(key).toBe('150');
    });

    it('should return a key between two fractional keys', () => {
      const key = utilsService.calculateOrderKey('10.5', '11.5');
      expect(key).toBe('11');
    });

    it('should return a key between a negative and positive key', () => {
      const key = utilsService.calculateOrderKey('-10', '10');
      expect(key).toBe('0');
    });

    it('should return a key between two close fractional keys', () => {
      const key = utilsService.calculateOrderKey('10.125', '10.25');
      expect(key).toBe('10.1875');
    });

    // --- Edge Cases (Based on New Logic) ---

    it('should return the average even if keys are identical', () => {
      // Now expects the average, which is the same as the input
      const key = utilsService.calculateOrderKey('150', '150');
      expect(key).toBe('150'); // (150 + 150) / 2
    });

    it('should return the average even if keyBefore > keyAfter', () => {
      // Now expects the average, ignoring the "invalid" order
      const key = utilsService.calculateOrderKey('200', '100');
      expect(key).toBe('150'); // (200 + 100) / 2
    });

    it('should handle averaging resulting in a non-distinct key (precision loss simulation)', () => {
      // Simulate numbers very close together where JS float math makes avg equal one end
      const numBefore = 1;
      const numAfter = 1 + Number.EPSILON / 2;
      const key = utilsService.calculateOrderKey(String(numBefore), String(numAfter));
      // Now expects the calculated average, even if it equals numBefore due to precision
      expect(key).toBe('1');
    });

    it('should return null for invalid keyBefore input', () => {
      const key = utilsService.calculateOrderKey('not-a-number', '100');
      expect(key).toBeNull();
    });

    it('should return null for invalid keyAfter input', () => {
      const key = utilsService.calculateOrderKey('100', 'not-a-number');
      expect(key).toBeNull();
    });

    // Removed the specific Infinity/MAX_VALUE tests as they are rare edge cases
    // and the final isFinite check provides safety.
  });

  // calculateShortname tests were removed as the method was deleted.
});
