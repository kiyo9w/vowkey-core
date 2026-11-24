import { describe, it, expect, afterEach } from '@jest/globals';
import {
  handleList,
  handleGet,
  handleGenerate,
  handleCreateItem,
  handleCreateFolder,
  handleDelete,
  handleConfirm,
  handleCreateOrgCollection,
  handleMove,
  handleDeviceApprovalList,
  handleDeviceApprovalApprove,
  handleDeviceApprovalDeny,
  handleRestore,
  handleCreateTextSend,
  handleCreateFileSend,
  handleGetSend,
  handleDeleteSend,
  handleRemoveSendPassword,
  handleCreateAttachment,
} from '../src/handlers/cli.js';

describe('CLI Handlers - Validation Tests', () => {
  describe('handleList', () => {
    it('should reject invalid type', async () => {
      const result = await handleList({ type: 'invalid' as 'items' });

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('Validation error');
    });

    it('should reject org-collections without organizationid', async () => {
      const result = await handleList({ type: 'org-collections' });

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('organizationid is required');
    });
  });

  describe('handleGet', () => {
    it('should reject empty id', async () => {
      const result = await handleGet({ object: 'item', id: '' });

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('Validation error');
    });

    it('should reject org-collection without organizationid', async () => {
      const result = await handleGet({ object: 'org-collection', id: 'test' });

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('organizationid is required');
    });

    it('should reject attachment without itemid', async () => {
      const result = await handleGet({ object: 'attachment', id: 'file.txt' });

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('itemid is required');
    });

    describe('attachment output allowlist enforcement', () => {
      const originalEnv = process.env['VOWKEY_ALLOWED_DIRECTORIES'];

      afterEach(() => {
        if (originalEnv !== undefined) {
          process.env['VOWKEY_ALLOWED_DIRECTORIES'] = originalEnv;
        } else {
          delete process.env['VOWKEY_ALLOWED_DIRECTORIES'];
        }
      });

      // Omitting output must not let `vowkey` fall back to writing the decrypted
      // attachment into the server's working directory.
      it('should reject attachment without output when allowlist is set', async () => {
        const result = await handleGet({
          object: 'attachment',
          id: 'id_rsa',
          itemid: '11111111-1111-1111-1111-111111111111',
        });

        expect(result.isError).toBe(true);
        expect(result.content[0]!.text).toContain(
          'output is required for attachment',
        );
      });

      it('should reject attachment without output when allowlist is unset', async () => {
        delete process.env['VOWKEY_ALLOWED_DIRECTORIES'];

        const result = await handleGet({
          object: 'attachment',
          id: 'id_rsa',
          itemid: '11111111-1111-1111-1111-111111111111',
        });

        expect(result.isError).toBe(true);
        expect(result.content[0]!.text).toContain(
          'output is required for attachment',
        );
      });

      it('should reject attachment with empty output', async () => {
        const result = await handleGet({
          object: 'attachment',
          id: 'id_rsa',
          itemid: '11111111-1111-1111-1111-111111111111',
          output: '',
        });

        expect(result.isError).toBe(true);
        expect(result.content[0]!.text).toContain(
          'output is required for attachment',
        );
      });

      it('should reject attachment with output outside the allowlist', async () => {
        process.env['VOWKEY_ALLOWED_DIRECTORIES'] = '/tmp/vowkey-allowed';

        const result = await handleGet({
          object: 'attachment',
          id: 'id_rsa',
          itemid: '11111111-1111-1111-1111-111111111111',
          output: '/var/tmp/',
        });

        expect(result.isError).toBe(true);
        expect(result.content[0]!.text).toContain('Invalid output path');
      });

      it('should reject attachment with an encoded output path', async () => {
        process.env['VOWKEY_ALLOWED_DIRECTORIES'] = '/tmp/vowkey-allowed';

        const result = await handleGet({
          object: 'attachment',
          id: 'id_rsa',
          itemid: '11111111-1111-1111-1111-111111111111',
          output: '/tmp/vowkey-allowed%2Fsub/',
        });

        expect(result.isError).toBe(true);
        expect(result.content[0]!.text).toContain('Invalid output path');
      });

      it('should reject attachment with any output when allowlist is unset', async () => {
        delete process.env['VOWKEY_ALLOWED_DIRECTORIES'];

        const result = await handleGet({
          object: 'attachment',
          id: 'id_rsa',
          itemid: '11111111-1111-1111-1111-111111111111',
          output: '/tmp/',
        });

        expect(result.isError).toBe(true);
        expect(result.content[0]!.text).toContain('Invalid output path');
      });
    });
  });

  describe('handleGenerate', () => {
    it('should reject length less than 5', async () => {
      const result = await handleGenerate({ length: 4 });

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('Validation error');
    });
  });

  describe('handleCreateItem', () => {
    it('should reject empty name', async () => {
      const result = await handleCreateItem({
        name: '',
        type: 2,
        secureNote: { type: 0 },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('Validation error');
    });

    it('should reject login item without login details', async () => {
      const result = await handleCreateItem({
        name: 'Test',
        type: 1,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain(
        'Type-specific data is required',
      );
    });

    it('should reject card item without card details', async () => {
      const result = await handleCreateItem({
        name: 'Test Card',
        type: 3,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain(
        'Type-specific data is required',
      );
    });

    it('should reject identity item without identity details', async () => {
      const result = await handleCreateItem({
        name: 'Test Identity',
        type: 4,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain(
        'Type-specific data is required',
      );
    });

    it('should reject secure note item without secureNote details', async () => {
      const result = await handleCreateItem({
        name: 'Test Note',
        type: 2,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain(
        'Type-specific data is required',
      );
    });
  });

  describe('handleCreateFolder', () => {
    it('should reject empty name', async () => {
      const result = await handleCreateFolder({ name: '' });

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('Validation error');
    });
  });

  describe('handleDelete', () => {
    it('should reject empty id', async () => {
      const result = await handleDelete({ object: 'item', id: '' });

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('Validation error');
    });
  });

  describe('handleConfirm', () => {
    it('should reject empty organizationId', async () => {
      const result = await handleConfirm({
        organizationId: '',
        memberId: 'member-123',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('Validation error');
    });

    it('should reject empty memberId', async () => {
      const result = await handleConfirm({
        organizationId: 'org-123',
        memberId: '',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('Validation error');
    });
  });

  describe('handleCreateOrgCollection', () => {
    it('should reject empty organizationId', async () => {
      const result = await handleCreateOrgCollection({
        organizationId: '',
        name: 'Collection',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('Validation error');
    });

    it('should reject empty name', async () => {
      const result = await handleCreateOrgCollection({
        organizationId: 'org-123',
        name: '',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('Validation error');
    });
  });

  describe('handleMove', () => {
    it('should reject empty itemId', async () => {
      const result = await handleMove({
        itemId: '',
        organizationId: 'org-123',
        collectionIds: ['coll-1'],
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('Validation error');
    });
  });

  describe('Device Approval Handlers', () => {
    describe('handleDeviceApprovalList', () => {
      it('should reject empty organizationId', async () => {
        const result = await handleDeviceApprovalList({ organizationId: '' });

        expect(result.isError).toBe(true);
        expect(result.content[0]!.text).toContain('Validation error');
      });
    });

    describe('handleDeviceApprovalApprove', () => {
      it('should reject empty requestId', async () => {
        const result = await handleDeviceApprovalApprove({
          organizationId: 'org-123',
          requestId: '',
        });

        expect(result.isError).toBe(true);
        expect(result.content[0]!.text).toContain('Validation error');
      });
    });

    describe('handleDeviceApprovalDeny', () => {
      it('should reject empty requestId', async () => {
        const result = await handleDeviceApprovalDeny({
          organizationId: 'org-123',
          requestId: '',
        });

        expect(result.isError).toBe(true);
        expect(result.content[0]!.text).toContain('Validation error');
      });
    });
  });

  describe('handleRestore', () => {
    it('should reject empty id', async () => {
      const result = await handleRestore({ object: 'item', id: '' });

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('Validation error');
    });
  });

  describe('Send Handlers', () => {
    describe('handleCreateTextSend', () => {
      it('should reject empty name', async () => {
        const result = await handleCreateTextSend({
          name: '',
          text: 'content',
        });

        expect(result.isError).toBe(true);
        expect(result.content[0]!.text).toContain('Validation error');
      });

      it('should reject empty text', async () => {
        const result = await handleCreateTextSend({
          name: 'Test',
          text: '',
        });

        expect(result.isError).toBe(true);
        expect(result.content[0]!.text).toContain('Validation error');
      });
    });

    describe('handleCreateFileSend', () => {
      it('should reject empty name', async () => {
        const result = await handleCreateFileSend({
          name: '',
          filePath: '/tmp/test.txt',
        });

        expect(result.isError).toBe(true);
        expect(result.content[0]!.text).toContain('Validation error');
      });

      it('should reject empty filePath', async () => {
        const result = await handleCreateFileSend({
          name: 'Test',
          filePath: '',
        });

        expect(result.isError).toBe(true);
        expect(result.content[0]!.text).toContain('Validation error');
      });

      it('should reject path traversal in filePath', async () => {
        const result = await handleCreateFileSend({
          name: 'Bad Send',
          filePath: '../../../etc/passwd',
        });

        expect(result.isError).toBe(true);
        expect(result.content[0]!.text).toContain('path traversal');
      });
    });

    describe('handleGetSend', () => {
      it('should reject empty id', async () => {
        const result = await handleGetSend({ id: '' });

        expect(result.isError).toBe(true);
        expect(result.content[0]!.text).toContain('Validation error');
      });
    });

    describe('handleDeleteSend', () => {
      it('should reject empty id', async () => {
        const result = await handleDeleteSend({ id: '' });

        expect(result.isError).toBe(true);
        expect(result.content[0]!.text).toContain('Validation error');
      });
    });

    describe('handleRemoveSendPassword', () => {
      it('should reject empty id', async () => {
        const result = await handleRemoveSendPassword({ id: '' });

        expect(result.isError).toBe(true);
        expect(result.content[0]!.text).toContain('Validation error');
      });
    });
  });

  describe('handleCreateAttachment', () => {
    it('should reject empty filePath', async () => {
      const result = await handleCreateAttachment({
        filePath: '',
        itemId: 'item-123',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('Validation error');
    });

    it('should reject empty itemId', async () => {
      const result = await handleCreateAttachment({
        filePath: '/tmp/test.txt',
        itemId: '',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('Validation error');
    });

    it('should reject path traversal in filePath', async () => {
      const result = await handleCreateAttachment({
        filePath: '../../secret.txt',
        itemId: 'item-123',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('path traversal');
    });
  });
});
