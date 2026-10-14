// src/managers/ApiDocsManager.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

/**
 * Builds the Swagger UI adapter used by the running GW service.
 *
 * In addition to selecting generated OpenAPI profiles, the adapter renders an
 * accessible contract map before the endpoint catalogue. The map teaches the
 * ordered integration flow: establish the actor through DCR/SMART, call a
 * semantic SDK facade, submit and poll the public GW transport, let GW resolve
 * internal operation references, and perform authoritative readback. It also
 * labels administrative aggregates and compatibility routes so HTTP
 * reachability is not mistaken for the recommended application contract.
 *
 * Keep this explanation synchronized with
 * `docs/01-OVERVIEW-AND-GUIDES/01.I-GW-CORE-CONTRACT-MAP.md` and its unit test.
 */
export function createApiDocsSetupOptions(
  swaggerSpecUrl = '/swagger-spec.json',
  swaggerSpecUrls?: Array<{ url: string; name: string }>,
): any {
  const globalContextScript = `
    (() => {
      const KEY_PREFIX = 'gw-api-docs:';
      const PANEL_VERSION = '2026-05-25-individual-did-v5';
      const DESKTOP_PANEL_WIDTH = 360;
      const fields = [
        { key: 'testId', label: 'test id', placeholder: '01' },
        { key: 'taxTenantId', label: 'taxTenantId', placeholder: 'acme-id' },
        { key: 'jurisdiction', label: 'jurisdiction', placeholder: 'ES' },
        { key: 'sector', label: 'sector', placeholder: 'health-care' },
        { key: 'hostSector', label: 'network type', placeholder: 'test' },
        { key: 'portalNamespace', label: 'portal namespace', placeholder: 'globaldatacare.es' },
        { key: 'individualUuid', label: 'individualUuid', placeholder: 'a87e5b15-aea4-4475-9c7c-40aa88354b6f' },
        { key: 'individualDid', label: 'individualDid', placeholder: 'did:web:globaldatacare.es:<sector>:individual:multibase:<derived>' },
        { key: 'individualControllerEmail', label: 'individualControllerEmail', placeholder: 'guardian@example.org' },
        { key: 'individualControllerRole', label: 'individualControllerRole', placeholder: 'v3-RoleCode|RESPRSN' },
        { key: 'individualControllerDid', label: 'individualControllerDid', placeholder: 'did:web:globaldatacare.es:<sector>:individual:multibase:<derived>:family:<derived>:v3-RoleCode|RESPRSN' },
        { key: 'physicianEmail', label: 'physicianEmail', placeholder: 'doctor1@acme.org' },
        { key: 'physicianRole', label: 'physicianRole', placeholder: 'ISCO-08|2211' },
        { key: 'sectionsAllowed', label: 'sectionsAllowed', placeholder: 'LOINC|48765-2' },
        { key: 'physicianOrg', label: 'physicianOrg', placeholder: 'did:web:globaldatacare.es:<sector>:organization:taxid:<taxTenantId>' },
        { key: 'physicianDid', label: 'physicianDid', placeholder: 'did:web:globaldatacare.es:<sector>:organization:taxid:<taxTenantId>:member:<derived>:ISCO-08|2211' },
        { key: 'offerId', label: 'offerId', placeholder: 'urn:...:Offer:...' },
        { key: 'activationCode', label: 'activationCode', placeholder: 'lic-...' },
        { key: 'licenseId', label: 'licenseId', placeholder: 'lic-...' },
      ];

      function getValue(key) { return localStorage.getItem(KEY_PREFIX + key) || ''; }
      function setValue(key, value) { localStorage.setItem(KEY_PREFIX + key, value || ''); }
      function removeValue(key) { localStorage.removeItem(KEY_PREFIX + key); }
      function getDerivedValue(key) { return localStorage.getItem(KEY_PREFIX + '__derived__:' + key) || ''; }
      function setDerivedValue(key, value) { localStorage.setItem(KEY_PREFIX + '__derived__:' + key, value || ''); }
      function getPanelOpen() { return localStorage.getItem(KEY_PREFIX + '__panelOpen') === '1'; }
      function setPanelOpen(nextValue) { localStorage.setItem(KEY_PREFIX + '__panelOpen', nextValue ? '1' : '0'); }
      const paramDefaults = {
        tenantId: 'acme-id',
        jurisdiction: 'ES',
        sector: 'health-care',
      };

      function normalizeLegacyCanonicalTenantId(value) {
        const current = String(value || '').trim();
        if (!current || current === 'acme' || current === 'TaxNumber-acme') return 'acme-id';
        return current;
      }

      function getCanonicalTenantId() {
        return normalizeLegacyCanonicalTenantId(
          getValue('taxTenantId') || getValue('tenantId') || getValue('taxId') || 'acme-id'
        );
      }

      function isLegacyTenantLike(value) {
        const current = String(value || '').trim();
        return !current || current === 'acme' || current === 'TaxNumber-acme';
      }

      function isLegacyIndividualDid(value) {
        const current = String(value || '').trim();
        if (!current) return true;
        return current.includes('<derived>')
          || current.includes('<unified-health-identifier>')
          || current.includes('did:web:api.acme.org:individual:');
      }

      function isLegacyPhysicianOrgDid(value) {
        const current = String(value || '').trim();
        if (!current) return true;
        return current.includes('<taxTenantId>')
          || current.includes('TaxNumber-acme')
          || current.includes('did:web:hospital.example.com')
          || current.includes('did:web:api.acme.org:organization:');
      }
      function isLegacyPhysicianDid(value) {
        const current = String(value || '').trim();
        if (!current) return true;
        return current.includes('doctor1@acme.org')
          || current.includes('did:web:api.acme.org:employee:')
          || current.includes('<derived>')
          || current.includes(':employee:')
          || current.includes('did:web:hospital.example.com');
      }
      function isLegacyIndividualControllerDid(value) {
        const current = String(value || '').trim();
        if (!current) return true;
        return current.includes('guardian@example.org')
          || current.includes('did:web:api.acme.org:family:')
          || current.includes('<derived>')
          || current.includes('did:web:hospital.example.com');
      }
      const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

      function hexToBytes(hex) {
        const clean = String(hex || '').trim();
        if (!clean || clean.length % 2 !== 0) return null;
        const bytes = [];
        for (let i = 0; i < clean.length; i += 2) {
          const value = Number.parseInt(clean.slice(i, i + 2), 16);
          if (!Number.isFinite(value)) return null;
          bytes.push(value);
        }
        return bytes;
      }

      function encodeBase58(bytes) {
        if (!Array.isArray(bytes) || bytes.length === 0) return '';
        let digits = [0];
        for (const byte of bytes) {
          let carry = byte;
          for (let i = 0; i < digits.length; i += 1) {
            const value = (digits[i] << 8) + carry;
            digits[i] = value % 58;
            carry = Math.floor(value / 58);
          }
          while (carry > 0) {
            digits.push(carry % 58);
            carry = Math.floor(carry / 58);
          }
        }
        let leadingZeroes = 0;
        while (leadingZeroes < bytes.length && bytes[leadingZeroes] === 0) leadingZeroes += 1;
        let result = '';
        for (let i = 0; i < leadingZeroes; i += 1) result += BASE58_ALPHABET[0];
        for (let i = digits.length - 1; i >= 0; i -= 1) result += BASE58_ALPHABET[digits[i]];
        return result;
      }

      async function sha256Multibase58btc(inputValue) {
        const normalized = String(inputValue || '').trim().toLowerCase();
        if (!normalized || !globalThis.crypto || !globalThis.crypto.subtle) return '';
        const digestBuffer = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
        const digestBytes = Array.from(new Uint8Array(digestBuffer));
        return 'z' + encodeBase58([0x12, 0x20, ...digestBytes]);
      }

      function uuidToMultibase58btc(uuidValue) {
        const normalized = String(uuidValue || '').trim().toLowerCase();
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)) {
          return '';
        }
        const bytes = hexToBytes(normalized.replace(/-/g, ''));
        if (!bytes) return '';
        return 'z' + encodeBase58(bytes);
      }

      function buildPhysicianOrgDid() {
        const portalNamespace = getValue('portalNamespace');
        const sector = getValue('sector');
        const taxId = getCanonicalTenantId();
        if (!portalNamespace || !sector || !taxId) return '';
        return 'did:web:' + portalNamespace + ':' + sector + ':organization:taxid:' + taxId;
      }

      function buildMemberDid(ownerDid, memberId, roleCode) {
        if (!ownerDid || !memberId || !roleCode) return '';
        return ownerDid + ':member:' + memberId + ':' + roleCode;
      }

      function buildIndividualControllerDid(subjectDid, controllerId, roleCode) {
        if (!subjectDid || !controllerId || !roleCode) return '';
        return subjectDid + ':family:' + controllerId + ':' + roleCode;
      }

      function buildIndividualDid(individualIdOverride) {
        const portalNamespace = getValue('portalNamespace');
        const sector = getValue('sector');
        const individualId = individualIdOverride || getDerivedValue('individualId');
        if (!portalNamespace || !sector || !individualId) return '';
        return 'did:web:' + portalNamespace + ':' + sector + ':individual:multibase:' + individualId;
      }

      function getCurrentIndividualId() {
        const explicitDid = getValue('individualDid');
        const match = String(explicitDid || '').match(/:multibase:([^:/?#]+)$/);
        if (match && match[1]) return match[1];
        return getDerivedValue('individualId') || '';
      }

      function syncDerivedField(key, nextValue) {
        if (!nextValue) return;
        const currentValue = getValue(key);
        const previousDerived = getDerivedValue(key);
        const shouldReplaceLegacyValue =
          (key === 'tenantId' || key === 'taxId') && isLegacyTenantLike(currentValue)
          || (key === 'individualDid' && isLegacyIndividualDid(currentValue))
          || (key === 'physicianOrg' && isLegacyPhysicianOrgDid(currentValue))
          || (key === 'physicianDid' && isLegacyPhysicianDid(currentValue))
          || (key === 'individualControllerDid' && isLegacyIndividualControllerDid(currentValue));
        if (!currentValue || currentValue === previousDerived || shouldReplaceLegacyValue) {
          setValue(key, nextValue);
          refreshInputIfEmpty(key, nextValue);
        }
        setDerivedValue(key, nextValue);
      }

      function migrateLegacyContextValues() {
        const canonicalTenantId = getCanonicalTenantId();
        setValue('taxTenantId', canonicalTenantId);
        setValue('tenantId', canonicalTenantId);
        setValue('taxId', canonicalTenantId);
        removeValue('__derived__:tenantId');
        removeValue('__derived__:taxId');
      }

      async function refreshDerivedContextValues() {
        const canonicalId = getCanonicalTenantId();
        syncDerivedField('tenantId', canonicalId);
        syncDerivedField('taxId', canonicalId);
        const derivedIndividualId = uuidToMultibase58btc(getValue('individualUuid'));
        syncDerivedField('individualId', derivedIndividualId);
        const physicianOrgDid = buildPhysicianOrgDid();
        const individualDid = buildIndividualDid(derivedIndividualId);
        syncDerivedField('individualDid', individualDid);
        syncDerivedField('physicianOrg', physicianOrgDid);
        const physicianMemberId = await sha256Multibase58btc(getValue('physicianEmail'));
        syncDerivedField('physicianDid', buildMemberDid(physicianOrgDid, physicianMemberId, getValue('physicianRole')));
        const individualControllerId = await sha256Multibase58btc(getValue('individualControllerEmail'));
        syncDerivedField('individualControllerDid', buildIndividualControllerDid(individualDid, individualControllerId, getValue('individualControllerRole')));
      }

      function getContextValueForParam(paramName) {
        if (paramName === 'tenantId') return getCanonicalTenantId();
        if (paramName === 'jurisdiction') return getValue('jurisdiction');
        if (paramName === 'sector') return getValue('sector');
        return '';
      }

      function buildTemplateReplacements() {
        const testId = getValue('testId');
        const tenantId = getCanonicalTenantId();
        const taxId = tenantId;
        const sector = getValue('sector');
        const individualId = getCurrentIndividualId();
        const individualControllerEmail = getValue('individualControllerEmail');
        const individualControllerRole = getValue('individualControllerRole');
        const individualControllerDid = getValue('individualControllerDid');
        const physicianEmail = getValue('physicianEmail');
        const physicianRole = getValue('physicianRole');
        const sectionsAllowed = getValue('sectionsAllowed');
        const physicianOrg = getValue('physicianOrg');
        const physicianDid = getValue('physicianDid');
        const individualDid = getValue('individualDid') || buildIndividualDid(individualId);
        const offerId = getValue('offerId');
        const activationCode = getValue('activationCode');
        const licenseId = getValue('licenseId');
        return {
          '{{testId}}': testId,
          '{{id}}': testId,
          '<test-id>': testId,
          '{{tenantId}}': tenantId,
          '{{taxId}}': taxId,
          '{{sector}}': sector,
          '{{individualId}}': individualId,
          '{{individualDid}}': individualDid,
          '{{individualControllerEmail}}': individualControllerEmail,
          '{{individualControllerRole}}': individualControllerRole,
          '{{individualControllerDid}}': individualControllerDid,
          '{{physicianEmail}}': physicianEmail,
          '{{physicianRole}}': physicianRole,
          '{{sectionsAllowed}}': sectionsAllowed,
          '{{physicianOrg}}': physicianOrg,
          '{{physicianDid}}': physicianDid,
          '{{offerId}}': offerId,
          '<offer-id>': offerId,
          '{{activationCode}}': activationCode,
          '<license-activation-code>': activationCode,
          '{{licenseId}}': licenseId,
          '{CUSTOMER_DID_WEB}': individualDid,
          '{ORGANIZATION_DID_WEB}': physicianOrg,
        };
      }

      function applyTemplateReplacements(inputText) {
        let output = String(inputText || '');
        const replacements = buildTemplateReplacements();
        for (const token of Object.keys(replacements)) {
          const value = replacements[token];
          if (value) output = output.split(token).join(value);
        }
        return output;
      }

      function syncSwaggerParameterInputs(force) {
        const rows = document.querySelectorAll('.parameters-container tr, .parameters tr');
        for (const row of rows) {
          const nameEl = row.querySelector('.parameter__name');
          const paramName = nameEl ? String(nameEl.textContent || '').trim().split('\\n')[0].trim() : '';
          if (!paramName) continue;
          const nextValue = getContextValueForParam(paramName);
          if (!nextValue) continue;

          const input = row.querySelector('input[type="text"], textarea');
          if (!input) continue;
          const currentValue = String(input.value || '').trim();
          const defaultValue = paramDefaults[paramName] || '';
          const canReplace = force || !currentValue || currentValue === defaultValue;
          if (!canReplace || currentValue === nextValue) continue;

          input.value = nextValue;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }

      function syncSwaggerRequestBodyEditors() {
        const testId = getValue('testId');
        const tenantId = getCanonicalTenantId();
        const taxId = tenantId;
        const sector = getValue('sector');
        const activationCode = getValue('activationCode');
        const individualId = getCurrentIndividualId();
        const individualControllerEmail = getValue('individualControllerEmail');
        const individualControllerRole = getValue('individualControllerRole');
        const individualControllerDid = getValue('individualControllerDid');
        const physicianEmail = getValue('physicianEmail');
        const physicianRole = getValue('physicianRole');
        const sectionsAllowed = getValue('sectionsAllowed');
        const physicianOrg = getValue('physicianOrg');
        const physicianDid = getValue('physicianDid');
        const individualDid = getValue('individualDid') || buildIndividualDid(individualId);
        const withTestId = (value) => {
          if (!testId || typeof value !== 'string') return value;
          if (value.includes('{{testId}}')) return value.split('{{testId}}').join(testId);
          if (value.includes('{{id}}')) return value.split('{{id}}').join(testId);
          if (value.includes('<test-id>')) return value.split('<test-id>').join(testId);
          if (value.endsWith('-' + testId)) return value;
          const looksLikeTemplateId =
            /(request-id|response-id|message-id|thread-id)$/i.test(value) ||
            /^thid-/i.test(value) ||
            /^jti-/i.test(value);
          return looksLikeTemplateId ? (value + '-' + testId) : value;
        };
        const applyKnownOverrides = (node) => {
          if (!node || typeof node !== 'object') return;
          if (Array.isArray(node)) {
            for (const item of node) applyKnownOverrides(item);
            return;
          }

          if ('jti' in node) node.jti = withTestId(node.jti);
          if ('thid' in node) node.thid = withTestId(node.thid);
          if (activationCode && typeof node.subject_token === 'string') node.subject_token = activationCode;
          if (physicianEmail && typeof node.iss === 'string') node.iss = String(node.iss).replaceAll('doctor1@acme.org', physicianEmail);
          if (physicianRole && typeof node.iss === 'string') node.iss = String(node.iss).replaceAll('ISCO-08|2211', physicianRole);
          if (physicianEmail && typeof node.sub === 'string') node.sub = String(node.sub).replaceAll('doctor1@acme.org', physicianEmail);
          if (physicianRole && typeof node.sub === 'string') node.sub = String(node.sub).replaceAll('ISCO-08|2211', physicianRole);
          if (physicianEmail && typeof node.client_id === 'string') node.client_id = String(node.client_id).replaceAll('doctor1@acme.org', physicianEmail);
          if (individualControllerEmail && typeof node.sub === 'string') node.sub = String(node.sub).replaceAll('guardian@example.org', individualControllerEmail);
          if (individualControllerRole && typeof node.sub === 'string') node.sub = String(node.sub).replaceAll('v3-RoleCode|RESPRSN', individualControllerRole);
          if (sectionsAllowed && typeof node.scope === 'string') node.scope = String(node.scope).replace(/section=[^\\s]+/g, 'section=' + sectionsAllowed);

          const claims = node.claims;
          if (claims && typeof claims === 'object') {
            if (tenantId) {
              if ('org.schema.Organization.alternateName' in claims) claims['org.schema.Organization.alternateName'] = tenantId;
              if ('Organization.alternateName' in claims) claims['Organization.alternateName'] = tenantId;
            }
            if (taxId) {
              if ('org.schema.Organization.identifier.value' in claims) claims['org.schema.Organization.identifier.value'] = taxId;
              if ('Organization.identifier.value' in claims) claims['Organization.identifier.value'] = taxId;
              if ('org.schema.Organization.identifierValue' in claims) claims['org.schema.Organization.identifierValue'] = taxId;
              if ('Organization.identifierValue' in claims) claims['Organization.identifierValue'] = taxId;
            }
            if (sector) {
              if ('org.schema.Service.category' in claims) claims['org.schema.Service.category'] = sector;
              if ('Service.category' in claims) claims['Service.category'] = sector;
            }
            if (physicianEmail) {
              if ('org.schema.Person.email' in claims) claims['org.schema.Person.email'] = String(claims['org.schema.Person.email']).replaceAll('doctor1@acme.org', physicianEmail);
              if ('Person.email' in claims) claims['Person.email'] = String(claims['Person.email']).replaceAll('doctor1@acme.org', physicianEmail);
            }
            if (physicianRole) {
              if ('org.schema.Person.hasOccupation.identifier.value' in claims) claims['org.schema.Person.hasOccupation.identifier.value'] = physicianRole;
              if ('Consent.actor-role' in claims) claims['Consent.actor-role'] = physicianRole;
            }
            if (individualControllerRole && 'RelatedPerson.relationship' in claims) {
              claims['RelatedPerson.relationship'] = individualControllerRole;
            }
            if (sectionsAllowed) {
              if ('Consent.action' in claims) claims['Consent.action'] = sectionsAllowed;
              if ('Composition.section' in claims) claims['Composition.section'] = sectionsAllowed;
            }
            if (individualId && 'Consent.subject' in claims && String(claims['Consent.subject']) === 'unified-health-id') {
              claims['Consent.subject'] = individualDid || individualId;
            }
            if (physicianOrg && 'Consent.grantee' in claims) claims['Consent.grantee'] = physicianOrg;
            if (physicianDid) {
              if ('Consent.actor-identifier' in claims) claims['Consent.actor-identifier'] = physicianDid;
              if ('Composition.author' in claims) claims['Composition.author'] = physicianDid;
            }
          }

          for (const [key, value] of Object.entries(node)) {
            if (typeof value === 'string') {
              let nextValue = value;
              if (individualId) nextValue = nextValue.replaceAll('<unified-health-identifier>', individualId);
              if (individualDid) nextValue = nextValue.replaceAll('{CUSTOMER_DID_WEB}', individualDid);
              if (individualControllerDid) nextValue = nextValue.replaceAll('{INDIVIDUAL_CONTROLLER_DID_WEB}', individualControllerDid);
              if (physicianDid) nextValue = nextValue.replaceAll('{PROFESSIONAL_DID_WEB}', physicianDid);
              if (physicianOrg) {
                nextValue = nextValue.replaceAll('{ORGANIZATION_DID_WEB}', physicianOrg);
                nextValue = nextValue.replaceAll('did:web:hospital.example.com', physicianOrg);
              }
              if (individualControllerDid) nextValue = nextValue.replaceAll('{{individualControllerDid}}', individualControllerDid);
              if (individualControllerEmail) nextValue = nextValue.replaceAll('guardian@example.org', individualControllerEmail);
              if (individualControllerRole) nextValue = nextValue.replaceAll('v3-RoleCode|RESPRSN', individualControllerRole);
              if (physicianDid) nextValue = nextValue.replaceAll('{{physicianDid}}', physicianDid);
              if (individualDid && nextValue === 'unified-health-id') nextValue = individualDid;
              if (sectionsAllowed) nextValue = nextValue.replaceAll('LOINC|48765-2', sectionsAllowed);
              if (physicianEmail) nextValue = nextValue.replaceAll('doctor1@acme.org', physicianEmail);
              if (physicianRole) nextValue = nextValue.replaceAll('ISCO-08|2211', physicianRole);
              node[key] = nextValue;
            } else if (value && typeof value === 'object') {
              applyKnownOverrides(value);
            }
          }
        };

        const editors = document.querySelectorAll('textarea.body-param__text');
        for (const editor of editors) {
          const currentValue = String(editor.value || '');
          if (!currentValue) continue;
          let nextValue = applyTemplateReplacements(currentValue);
          try {
            const parsed = JSON.parse(nextValue);
            applyKnownOverrides(parsed);
            nextValue = JSON.stringify(parsed, null, 2);
          } catch (_) {
            // Keep raw body when editor content is not valid JSON.
          }
          if (nextValue === currentValue) continue;
          editor.value = nextValue;
          editor.dispatchEvent(new Event('input', { bubbles: true }));
          editor.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      function nowTestId() {
        const d = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        return String(d.getFullYear())
          + pad(d.getMonth() + 1)
          + pad(d.getDate())
          + pad(d.getHours())
          + pad(d.getMinutes())
          + pad(d.getSeconds());
      }

      function ensureDefaultContextValues() {
        migrateLegacyContextValues();
        const canonicalTenantId = getCanonicalTenantId();
        if (!getValue('taxTenantId')) {
          setValue('taxTenantId', canonicalTenantId);
        }
        if (!getValue('jurisdiction')) {
          setValue('jurisdiction', 'ES');
        }
        if (!getValue('sector')) {
          setValue('sector', 'health-care');
        }
        if (!getValue('hostSector')) {
          setValue('hostSector', 'test');
        }
        if (!getValue('portalNamespace')) {
          setValue('portalNamespace', 'globaldatacare.es');
        }
        if (!getValue('individualUuid')) {
          setValue('individualUuid', 'a87e5b15-aea4-4475-9c7c-40aa88354b6f');
        }
        if (!getValue('individualControllerEmail')) {
          setValue('individualControllerEmail', 'guardian@example.org');
        }
        if (!getValue('individualControllerRole')) {
          setValue('individualControllerRole', 'v3-RoleCode|RESPRSN');
        }
        if (!getValue('physicianEmail')) {
          setValue('physicianEmail', 'doctor1@acme.org');
        }
        if (!getValue('physicianRole')) {
          setValue('physicianRole', 'ISCO-08|2211');
        }
        if (!getValue('sectionsAllowed')) {
          setValue('sectionsAllowed', 'LOINC|48765-2');
        }
        if (!getValue('testId')) {
          setValue('testId', nowTestId());
        }
        refreshDerivedContextValues();
      }

      function upsertGlobalContextPanel() {
        const existingLauncher = document.getElementById('gw-api-global-context-launcher');
        if (existingLauncher) existingLauncher.remove();
        const existingPanel = document.getElementById('gw-api-global-context');
        if (existingPanel) {
          const version = existingPanel.getAttribute('data-version') || '';
          if (version === PANEL_VERSION) {
            syncGlobalContextPanelState();
            return;
          }
          existingPanel.remove();
        }
        const launcher = document.createElement('button');
        launcher.type = 'button';
        launcher.id = 'gw-api-global-context-launcher';
        launcher.textContent = 'Flow Context';
        launcher.style.position = 'fixed';
        launcher.style.top = '12px';
        launcher.style.right = '12px';
        launcher.style.zIndex = '10000';
        launcher.style.border = '1px solid #c9c9c9';
        launcher.style.background = '#f8f8f8';
        launcher.style.borderRadius = '999px';
        launcher.style.padding = '8px 12px';
        launcher.style.fontSize = '12px';
        launcher.style.fontWeight = '600';
        launcher.style.cursor = 'pointer';
        launcher.style.boxShadow = '0 2px 10px rgba(15,23,42,0.10)';
        launcher.addEventListener('click', () => {
          setPanelOpen(!getPanelOpen());
          syncGlobalContextPanelState();
        });
        document.body.appendChild(launcher);

        const panel = document.createElement('div');
        panel.id = 'gw-api-global-context';
        panel.setAttribute('data-version', PANEL_VERSION);
        panel.style.boxSizing = 'border-box';
        panel.style.zIndex = '9999';
        panel.style.background = '#ffffff';
        panel.style.border = '1px solid #d9d9d9';
        panel.style.borderRadius = '12px';
        panel.style.padding = '16px';
        panel.style.boxShadow = '0 12px 36px rgba(15,23,42,0.18)';
        panel.style.width = DESKTOP_PANEL_WIDTH + 'px';
        panel.style.maxHeight = 'calc(100vh - 80px)';
        panel.style.overflow = 'auto';
        panel.style.display = 'none';

        const header = document.createElement('div');
        header.style.display = 'flex';
        header.style.alignItems = 'center';
        header.style.justifyContent = 'space-between';
        header.style.gap = '12px';
        header.style.marginBottom = '12px';

        const title = document.createElement('div');
        title.id = 'gw-api-global-context-title';
        title.textContent = 'Global Flow Context';
        title.style.fontWeight = '700';
        title.style.fontSize = '14px';

        const toggleButton = document.createElement('button');
        toggleButton.type = 'button';
        toggleButton.id = 'gw-api-global-context-toggle';
        toggleButton.style.border = '1px solid #c9c9c9';
        toggleButton.style.background = '#f8f8f8';
        toggleButton.style.borderRadius = '999px';
        toggleButton.style.padding = '6px 10px';
        toggleButton.style.fontSize = '12px';
        toggleButton.style.fontWeight = '600';
        toggleButton.style.cursor = 'pointer';
        toggleButton.addEventListener('click', () => {
          setPanelOpen(false);
          syncGlobalContextPanelState();
        });

        header.appendChild(title);
        header.appendChild(toggleButton);
        panel.appendChild(header);

        const body = document.createElement('div');
        body.id = 'gw-api-global-context-body';

        for (const field of fields) {
          const row = document.createElement('div');
          row.style.display = 'grid';
          row.style.gridTemplateColumns = '120px 1fr';
          row.style.gap = '8px';
          row.style.alignItems = 'center';
          row.style.marginBottom = '8px';

          const label = document.createElement('label');
          label.textContent = field.label;
          label.style.fontSize = '12px';
          label.style.fontWeight = '600';

          const input = document.createElement('input');
          input.type = 'text';
          input.id = 'gw-api-field-' + field.key;
          input.value = getValue(field.key);
          input.placeholder = field.placeholder;
          input.style.fontSize = '12px';
          input.style.padding = '6px 8px';
          input.style.border = '1px solid #d9d9d9';
          input.style.borderRadius = '4px';
          input.addEventListener('input', () => {
            setValue(field.key, input.value.trim());
            refreshDerivedContextValues();
            if (field.key === 'taxTenantId' || field.key === 'jurisdiction' || field.key === 'sector') {
              syncSwaggerParameterInputs(true);
            }
            syncSwaggerRequestBodyEditors();
          });

          row.appendChild(label);
          row.appendChild(input);
          body.appendChild(row);
        }

        const hint = document.createElement('div');
        hint.style.fontSize = '11px';
        hint.style.color = '#555';
        hint.style.marginTop = '10px';
        hint.style.lineHeight = '1.45';
        hint.textContent =
          'Values are auto-applied to path params, tenant/individual/physician helpers, SMART scopes, placeholders, and template jti/thid fields.';
        body.appendChild(hint);
        panel.appendChild(body);
        document.body.appendChild(panel);
        syncGlobalContextPanelState();
      }

      function upsertCoreContractMap() {
        if (document.getElementById('gw-core-contract-map')) return;
        const information = document.querySelector('.swagger-ui .information-container');
        if (!information || !information.parentNode) return;

        const map = document.createElement('section');
        map.id = 'gw-core-contract-map';
        map.className = 'gw-core-contract-map';
        map.setAttribute('aria-label', 'GW CORE public and internal contract map');
        map.innerHTML = [
          '<div class="gw-core-contract-heading">',
          '  <div><strong>How applications use GW CORE</strong><span>Public application contract versus internal resolution</span></div>',
          '  <div class="gw-core-contract-legend"><span data-level="public">Public</span><span data-level="internal">Internal operation</span><span data-level="compat">Compatibility only</span></div>',
          '</div>',
          '<div class="gw-core-contract-flow">',
          '  <div class="gw-core-contract-node" data-level="public"><b>Portal / channel</b><span>Browser or native UI</span></div>',
          '  <div class="gw-core-contract-arrow" aria-hidden="true">→</div>',
          '  <div class="gw-core-contract-node" data-level="public"><b>BFF / actor facade</b><span>requestClinicalSummary()</span></div>',
          '  <div class="gw-core-contract-arrow" aria-hidden="true">→</div>',
          '  <div class="gw-core-contract-node" data-level="public"><b>Communication/_batch</b><span>Auditable request and result channel</span></div>',
          '  <div class="gw-core-contract-arrow" aria-hidden="true">→</div>',
          '  <div class="gw-core-contract-node" data-level="internal"><b>Subject/$summary</b><span>Resolved inside GW; not called by application code</span></div>',
          '  <div class="gw-core-contract-arrow" aria-hidden="true">→</div>',
          '  <div class="gw-core-contract-node" data-level="internal"><b>Subject index</b><span>Composition, sections and encrypted projections</span></div>',
          '</div>',
          '<div class="gw-core-contract-secondary">',
          '  <div><b>Identity bootstrap</b><span>DCR registers the actor device; SMART scopes the actor, subject and operation before protected data access.</span></div>',
          '  <div><b>Administrative aggregates</b><span>Organization / License searches remain direct actor-scoped SDK operations; they are not clinical subject-index reads.</span></div>',
          '  <div data-level="compat"><b>Compatibility only</b><span>Direct Bundle/_search, Composition routes and Subject/$summary HTTP calls remain lower-level test or migration surfaces.</span></div>',
          '</div>',
          '<div class="gw-core-contract-lifecycle" aria-label="Asynchronous GW request lifecycle">',
          '  <b>Every asynchronous GW operation</b>',
          '  <ol>',
          '    <li><span>1</span><strong>Submit + thid</strong><small>Send one correlated command or query.</small></li>',
          '    <li><span>2</span><strong>202 Accepted</strong><small>Work is pending, not yet authoritative.</small></li>',
          '    <li><span>3</span><strong>Poll response</strong><small>Use the same thid until a final result.</small></li>',
          '    <li><span>4</span><strong>Exact readback</strong><small>Render only the final aggregate or projection.</small></li>',
          '  </ol>',
          '</div>',
        ].join('');
        information.parentNode.insertBefore(map, information.nextSibling);
      }

      function syncGlobalContextPanelState() {
        const launcher = document.getElementById('gw-api-global-context-launcher');
        const panel = document.getElementById('gw-api-global-context');
        const body = document.getElementById('gw-api-global-context-body');
        const toggleButton = document.getElementById('gw-api-global-context-toggle');
        const title = document.getElementById('gw-api-global-context-title');
        if (!launcher || !panel || !body || !toggleButton || !title) return;

        const open = getPanelOpen();
        panel.setAttribute('data-open', open ? '1' : '0');
        panel.style.display = open ? 'block' : 'none';
        body.style.display = 'block';
        title.textContent = 'Global Flow Context';
        toggleButton.textContent = 'Hide';
        launcher.textContent = open ? 'Hide Context' : 'Flow Context';
        launcher.setAttribute('aria-expanded', open ? 'true' : 'false');
        applyGlobalContextLayout();
      }

      function applyGlobalContextLayout() {
        const panel = document.getElementById('gw-api-global-context');
        if (!panel) return;

        const desktopWidth = Math.min(420, Math.max(300, Math.floor(window.innerWidth * 0.3)));
        panel.style.position = 'fixed';
        panel.style.top = '56px';
        panel.style.right = '12px';
        panel.style.left = 'auto';
        panel.style.bottom = 'auto';
        panel.style.height = 'auto';
        panel.style.width = window.innerWidth >= 900 ? desktopWidth + 'px' : 'calc(100vw - 24px)';
        panel.style.maxWidth = 'calc(100vw - 24px)';
        panel.style.border = '1px solid #d9d9d9';
        panel.style.borderRadius = '12px';
        panel.style.margin = '0';
        panel.style.padding = '16px';
        document.body.style.paddingRight = '0';
      }

      function refreshInputIfEmpty(key, nextValue) {
        if (!nextValue) return;
        const input = document.getElementById('gw-api-field-' + key);
        if (input && input.value !== nextValue) {
          input.value = nextValue;
        }
      }

      function wireAutoFillFromResponses() {
        if (!window.ui || window.__gwApiResponseHooked) return;
        window.__gwApiResponseHooked = true;
      }

      function parseRgbColor(colorValue) {
        const match = String(colorValue || '').match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/i);
        if (!match) return null;
        return [Number(match[1]), Number(match[2]), Number(match[3])];
      }

      function isTransparentColor(colorValue) {
        const value = String(colorValue || '').trim().toLowerCase();
        return !value || value === 'transparent' || /^rgba\\(\\s*0\\s*,\\s*0\\s*,\\s*0\\s*,\\s*0\\s*\\)$/.test(value);
      }

      function isDarkBackgroundColor(colorValue) {
        const rgb = parseRgbColor(colorValue);
        if (!rgb) return false;
        const [r, g, b] = rgb.map((v) => v / 255);
        const luminance = (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
        return luminance < 0.62;
      }

      function syncThemeContrastClass() {
        const root = document.documentElement;
        const uiEl = document.querySelector('.swagger-ui');
        const candidates = [
          uiEl ? getComputedStyle(uiEl).backgroundColor : '',
          getComputedStyle(document.body).backgroundColor,
          getComputedStyle(root).backgroundColor,
        ].filter((value) => !isTransparentColor(value));
        const bgColor = candidates[0] || '';
        const isDark = isDarkBackgroundColor(bgColor);
        root.classList.toggle('gw-api-docs-dark', isDark);
      }

      function init() {
        // Force typography fixes for long inline code (e.g., JWT examples) to avoid line overlap.
        if (!document.getElementById('gw-api-docs-inline-code-fix')) {
          const style = document.createElement('style');
          style.id = 'gw-api-docs-inline-code-fix';
          style.textContent = [
            'body { overflow-x: hidden; }',
            '.swagger-ui { box-sizing: border-box; }',
            '.swagger-ui .markdown p,',
            '.swagger-ui .markdown li,',
            '.swagger-ui .opblock-description-wrapper p,',
            '.swagger-ui .opblock-description-wrapper li,',
            '.swagger-ui .auth-container p,',
            '.swagger-ui .auth-container li { line-height: 1.5 !important; }',
            '.swagger-ui .markdown code,',
            '.swagger-ui .renderedMarkdown code,',
            '.swagger-ui .opblock-description-wrapper code,',
            '.swagger-ui .auth-container code,',
            '.swagger-ui .scheme-container code {',
            '  display: inline !important;',
            '  white-space: pre-wrap !important;',
            '  overflow-wrap: anywhere !important;',
            '  word-break: break-word !important;',
            '  line-height: 1.65 !important;',
            '  font-size: 12px !important;',
            '}',
            '.gw-api-docs-dark .swagger-ui .markdown,',
            '.gw-api-docs-dark .swagger-ui .renderedMarkdown,',
            '.gw-api-docs-dark .swagger-ui .opblock-description-wrapper,',
            '.gw-api-docs-dark .swagger-ui .auth-container { color: #e8e8e8 !important; }',
            '.gw-api-docs-dark .swagger-ui .markdown p,',
            '.gw-api-docs-dark .swagger-ui .markdown li,',
            '.gw-api-docs-dark .swagger-ui .markdown strong,',
            '.gw-api-docs-dark .swagger-ui .markdown em,',
            '.gw-api-docs-dark .swagger-ui .renderedMarkdown p,',
            '.gw-api-docs-dark .swagger-ui .renderedMarkdown li,',
            '.gw-api-docs-dark .swagger-ui .opblock-description-wrapper p,',
            '.gw-api-docs-dark .swagger-ui .opblock-description-wrapper li,',
            '.gw-api-docs-dark .swagger-ui .auth-container p,',
            '.gw-api-docs-dark .swagger-ui .auth-container li { color: #e8e8e8 !important; }',
            '.gw-api-docs-dark .swagger-ui .markdown li::marker,',
            '.gw-api-docs-dark .swagger-ui .renderedMarkdown li::marker,',
            '.gw-api-docs-dark .swagger-ui .opblock-description-wrapper li::marker { color: #e8e8e8 !important; }',
            '.gw-api-docs-dark .swagger-ui .responses-inner h4,',
            '.gw-api-docs-dark .swagger-ui .responses-inner h5,',
            '.gw-api-docs-dark .swagger-ui .responses-inner table th,',
            '.gw-api-docs-dark .swagger-ui .responses-inner table td,',
            '.gw-api-docs-dark .swagger-ui table.responses-table th,',
            '.gw-api-docs-dark .swagger-ui table.responses-table td,',
            '.gw-api-docs-dark .swagger-ui .response-col_links,',
            '.gw-api-docs-dark .swagger-ui .response-col_description,',
            '.gw-api-docs-dark .swagger-ui .response-col_status,',
            '.gw-api-docs-dark .swagger-ui .response-col_headers,',
            '.gw-api-docs-dark .swagger-ui .headers-wrapper,',
            '.gw-api-docs-dark .swagger-ui .headers-wrapper * { color: #e8e8e8 !important; }',
            '.swagger-ui { max-width: none !important; width: 100% !important; }',
          ].join('\\n');
          document.head.appendChild(style);
        }

        syncThemeContrastClass();
        upsertCoreContractMap();
        ensureDefaultContextValues();
        upsertGlobalContextPanel();
        applyGlobalContextLayout();
        wireAutoFillFromResponses();
        syncSwaggerParameterInputs(false);
        syncSwaggerRequestBodyEditors();

        const observer = new MutationObserver(() => {
          syncThemeContrastClass();
          upsertCoreContractMap();
          applyGlobalContextLayout();
          syncSwaggerParameterInputs(false);
          syncSwaggerRequestBodyEditors();
        });
        observer.observe(document.body, { childList: true, subtree: true });
        window.addEventListener('resize', applyGlobalContextLayout);
      }

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
      } else {
        init();
      }

      window.__gwApiDocsStore = {
        get: getValue,
        set: (key, value) => {
          setValue(key, value);
          refreshInputIfEmpty(key, value);
        },
      };
    })();
  `;

  return {
    customCss: `
      .swagger-ui .opblock-description-wrapper,
      .swagger-ui .opblock-description-wrapper p,
      .swagger-ui .opblock-description-wrapper li,
      .swagger-ui .markdown p,
      .swagger-ui .markdown li {
        line-height: 1.45 !important;
      }

      .swagger-ui .opblock-description-wrapper code,
      .swagger-ui .markdown code {
        white-space: normal !important;
        word-break: break-word !important;
        overflow-wrap: anywhere !important;
        line-height: 1.5 !important;
        font-size: 0.95em !important;
      }

      .gw-core-contract-map {
        max-width: 1460px;
        margin: 8px auto 24px;
        padding: 18px;
        border: 1px solid #cbd5e1;
        border-radius: 14px;
        background: linear-gradient(135deg, #f8fafc 0%, #eef6ff 100%);
        color: #0f172a;
        box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08);
        box-sizing: border-box;
      }

      .gw-core-contract-heading,
      .gw-core-contract-flow,
      .gw-core-contract-secondary,
      .gw-core-contract-legend {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .gw-core-contract-heading { justify-content: space-between; margin-bottom: 16px; }
      .gw-core-contract-heading strong { display: block; font-size: 18px; }
      .gw-core-contract-heading span { display: block; margin-top: 3px; font-size: 12px; }
      .gw-core-contract-legend span { padding: 5px 8px; border-radius: 999px; font-weight: 700; }
      .gw-core-contract-flow { align-items: stretch; }
      .gw-core-contract-node { flex: 1 1 0; min-width: 0; padding: 12px; border: 2px solid #0f766e; border-radius: 10px; background: #ecfdf5; }
      .gw-core-contract-node[data-level="internal"] { border-color: #b45309; background: #fffbeb; }
      .gw-core-contract-node b, .gw-core-contract-secondary b { display: block; margin-bottom: 5px; font-size: 13px; }
      .gw-core-contract-node span, .gw-core-contract-secondary span { display: block; font-size: 11px; line-height: 1.4; }
      .gw-core-contract-arrow { align-self: center; flex: 0 0 auto; color: #475569; font-size: 22px; font-weight: 800; }
      .gw-core-contract-secondary { margin-top: 12px; align-items: stretch; }
      .gw-core-contract-secondary > div { flex: 1; padding: 10px 12px; border: 1px solid #94a3b8; border-radius: 9px; background: #fff; }
      .gw-core-contract-secondary > div[data-level="compat"] { border-style: dashed; }
      .gw-core-contract-lifecycle { margin-top: 14px; padding-top: 14px; border-top: 1px solid #cbd5e1; }
      .gw-core-contract-lifecycle > b { display: block; margin-bottom: 10px; font-size: 13px; }
      .gw-core-contract-lifecycle ol { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin: 0; padding: 0; list-style: none; }
      .gw-core-contract-lifecycle li { position: relative; min-width: 0; padding: 10px 10px 10px 38px; border-radius: 9px; background: #e0f2fe; }
      .gw-core-contract-lifecycle li > span { position: absolute; left: 10px; top: 10px; display: grid; width: 20px; height: 20px; place-items: center; border-radius: 999px; background: #0369a1; color: #fff; font-size: 11px; font-weight: 800; }
      .gw-core-contract-lifecycle strong, .gw-core-contract-lifecycle small { display: block; }
      .gw-core-contract-lifecycle strong { font-size: 12px; }
      .gw-core-contract-lifecycle small { margin-top: 3px; font-size: 10px; line-height: 1.35; }
      .gw-core-contract-legend [data-level="public"] { background: #d1fae5; color: #065f46; }
      .gw-core-contract-legend [data-level="internal"] { background: #fef3c7; color: #92400e; }
      .gw-core-contract-legend [data-level="compat"] { background: #e2e8f0; color: #334155; }
      .gw-api-docs-dark .gw-core-contract-map { background: #111827; color: #f8fafc; border-color: #475569; }
      .gw-api-docs-dark .gw-core-contract-secondary > div { background: #1f2937; }
      .gw-api-docs-dark .gw-core-contract-lifecycle { border-color: #475569; }
      .gw-api-docs-dark .gw-core-contract-lifecycle li { background: #0c4a6e; }

      @media (max-width: 1100px) {
        .gw-core-contract-map { padding-top: 58px; }
        .gw-core-contract-heading, .gw-core-contract-flow, .gw-core-contract-secondary { flex-direction: column; align-items: stretch; }
        .gw-core-contract-lifecycle ol { grid-template-columns: 1fr; }
        .gw-core-contract-arrow { transform: rotate(90deg); text-align: center; }
        .gw-core-contract-legend { flex-wrap: wrap; }
      }
    `,
    swaggerOptions: {
      ...(Array.isArray(swaggerSpecUrls) && swaggerSpecUrls.length > 0
        ? {
            urls: swaggerSpecUrls,
            urlsPrimaryName: swaggerSpecUrls[0]?.name,
          }
        : {
            url: swaggerSpecUrl,
          }),
      parameterMacro: (operation: any, parameter: any) => {
        const browser: any = globalThis as any;
        const key = 'gw-api-docs:' + String(parameter?.name || '');
        const fallback = parameter?.schema?.example;
        const fromStorage = browser?.localStorage?.getItem ? browser.localStorage.getItem(key) : null;
        if (!fromStorage) return fallback;

        if (parameter?.name === 'sector') {
          const path = operation?.get ? String(operation.get('path') || '') : '';
          if (path.startsWith('/host/')) {
            const hostSector = browser?.localStorage?.getItem
              ? browser.localStorage.getItem('gw-api-docs:hostSector')
              : null;
            return hostSector || fromStorage;
          }
        }
        return fromStorage;
      },
      requestInterceptor: (request: any) => {
        const browser: any = globalThis as any;
        const getCtx = (key: string) =>
          browser?.localStorage?.getItem ? browser.localStorage.getItem('gw-api-docs:' + key) || '' : '';
        const normalizeLegacyCtxTenantId = (value: string) => {
          const current = String(value || '').trim();
          if (!current || current === 'acme' || current === 'TaxNumber-acme') return 'acme-id';
          return current;
        };
        const getCanonicalCtxTenantId = () => normalizeLegacyCtxTenantId(getCtx('taxTenantId') || getCtx('tenantId') || getCtx('taxId') || 'acme-id');
        const testId = getCtx('testId');
        const tenantId = getCanonicalCtxTenantId();
        const jurisdiction = getCtx('jurisdiction');
        const taxId = tenantId;
        const sector = getCtx('sector');
        const hostSector = getCtx('hostSector');
        const portalNamespace = getCtx('portalNamespace');
        const individualDidInput = getCtx('individualDid');
        const individualIdMatch = String(individualDidInput || '').match(/:multibase:([^:/?#]+)$/);
        const individualId = (individualIdMatch && individualIdMatch[1]) || getCtx('individualId');
        const individualControllerEmail = getCtx('individualControllerEmail');
        const individualControllerRole = getCtx('individualControllerRole');
        const individualControllerDid = getCtx('individualControllerDid');
        const physicianEmail = getCtx('physicianEmail');
        const physicianRole = getCtx('physicianRole');
        const sectionsAllowed = getCtx('sectionsAllowed');
        const physicianOrg = getCtx('physicianOrg')
          || (portalNamespace && sector && tenantId
            ? `did:web:${portalNamespace}:${sector}:organization:taxid:${tenantId}`
            : '');
        const physicianDid = getCtx('physicianDid');
        const individualDid = individualDidInput || (portalNamespace && sector && individualId
          ? `did:web:${portalNamespace}:${sector}:individual:multibase:${individualId}`
          : '');
        const offerId = getCtx('offerId');
        const activationCode = getCtx('activationCode');

        if (typeof request.url === 'string') {
          request.url = request.url.replace(
            /\/([^/]+)\/cds-([^/]+)\/v1\/([^/]+)\//,
            (_full: string, currentTenant: string, currentJurisdiction: string, currentSector: string) => {
              const nextTenant = currentTenant === 'host' ? 'host' : (tenantId || currentTenant);
              const nextJurisdiction = jurisdiction || currentJurisdiction;
              const nextSector = currentTenant === 'host'
                ? (hostSector || currentSector)
                : (sector || currentSector);
              return `/${nextTenant}/cds-${nextJurisdiction}/v1/${nextSector}/`;
            },
          );
        }

        const replacements: Record<string, string> = {
          '{{testId}}': testId,
          '{{id}}': testId,
          '<test-id>': testId,
          '{{tenantId}}': tenantId,
          '{{taxId}}': taxId,
          '{{sector}}': sector,
          '{{individualId}}': individualId,
          '{{individualDid}}': individualDid,
          '{{individualControllerEmail}}': individualControllerEmail,
          '{{individualControllerRole}}': individualControllerRole,
          '{{individualControllerDid}}': individualControllerDid,
          '{{physicianEmail}}': physicianEmail,
          '{{physicianRole}}': physicianRole,
          '{{sectionsAllowed}}': sectionsAllowed,
          '{{physicianOrg}}': physicianOrg,
          '{{physicianDid}}': physicianDid,
          '{{offerId}}': offerId,
          '<offer-id>': offerId,
          '{{activationCode}}': activationCode,
          '<license-activation-code>': activationCode,
          '{{licenseId}}': getCtx('licenseId'),
          '{CUSTOMER_DID_WEB}': individualDid,
          '{ORGANIZATION_DID_WEB}': physicianOrg,
        };

        const applyKnownOverrides = (node: any) => {
          if (!node || typeof node !== 'object') return;
          if (Array.isArray(node)) {
            for (const item of node) applyKnownOverrides(item);
            return;
          }

          const withTestId = (value: unknown): unknown => {
            if (!testId || typeof value !== 'string') return value;
            if (value.includes('{{testId}}')) {
              return value.split('{{testId}}').join(testId);
            }
            if (value.includes('{{id}}')) {
              return value.split('{{id}}').join(testId);
            }
            if (value.includes('<test-id>')) {
              return value.split('<test-id>').join(testId);
            }
            if (value.endsWith('-' + testId)) return value;
            const looksLikeTemplateId =
              /(request-id|response-id|message-id|thread-id)$/i.test(value) ||
              /^thid-/i.test(value) ||
              /^jti-/i.test(value);
            return looksLikeTemplateId ? (value + '-' + testId) : value;
          };

          if ('jti' in node) node.jti = withTestId(node.jti);
          if ('thid' in node) node.thid = withTestId(node.thid);

          if (activationCode && typeof node.subject_token === 'string') {
            node.subject_token = activationCode;
          }
          if (physicianEmail && typeof node.iss === 'string') {
            node.iss = String(node.iss).replaceAll('doctor1@acme.org', physicianEmail);
          }
          if (physicianRole && typeof node.iss === 'string') {
            node.iss = String(node.iss).replaceAll('ISCO-08|2211', physicianRole);
          }
          if (physicianEmail && typeof node.sub === 'string') {
            node.sub = String(node.sub).replaceAll('doctor1@acme.org', physicianEmail);
          }
          if (physicianRole && typeof node.sub === 'string') {
            node.sub = String(node.sub).replaceAll('ISCO-08|2211', physicianRole);
          }
          if (physicianEmail && typeof node.client_id === 'string') {
            node.client_id = String(node.client_id).replaceAll('doctor1@acme.org', physicianEmail);
          }
          if (individualControllerEmail && typeof node.sub === 'string') {
            node.sub = String(node.sub).replaceAll('guardian@example.org', individualControllerEmail);
          }
          if (individualControllerRole && typeof node.sub === 'string') {
            node.sub = String(node.sub).replaceAll('v3-RoleCode|RESPRSN', individualControllerRole);
          }
          if (sectionsAllowed && typeof node.scope === 'string') {
            node.scope = String(node.scope).replace(/section=[^\s]+/g, 'section=' + sectionsAllowed);
          }

          const claims = node.claims;
          if (claims && typeof claims === 'object') {
            if (tenantId) {
              if ('org.schema.Organization.alternateName' in claims) {
                claims['org.schema.Organization.alternateName'] = tenantId;
              }
              if ('Organization.alternateName' in claims) {
                claims['Organization.alternateName'] = tenantId;
              }
            }
            if (taxId) {
              if ('org.schema.Organization.identifier.value' in claims) {
                claims['org.schema.Organization.identifier.value'] = taxId;
              }
              if ('Organization.identifier.value' in claims) {
                claims['Organization.identifier.value'] = taxId;
              }
              if ('org.schema.Organization.identifierValue' in claims) {
                claims['org.schema.Organization.identifierValue'] = taxId;
              }
              if ('Organization.identifierValue' in claims) {
                claims['Organization.identifierValue'] = taxId;
              }
            }
            if (sector) {
              if ('org.schema.Service.category' in claims) {
                claims['org.schema.Service.category'] = sector;
              }
              if ('Service.category' in claims) {
                claims['Service.category'] = sector;
              }
            }
            if (offerId) {
              if ('Order.acceptedOffer.identifier' in claims) {
                claims['Order.acceptedOffer.identifier'] = offerId;
              }
              if ('org.schema.Order.acceptedOffer.identifier' in claims) {
                claims['org.schema.Order.acceptedOffer.identifier'] = offerId;
              }
            }
            if (physicianEmail) {
              if ('org.schema.Person.email' in claims) {
                claims['org.schema.Person.email'] = String(claims['org.schema.Person.email']).replaceAll('doctor1@acme.org', physicianEmail);
              }
              if ('Person.email' in claims) {
                claims['Person.email'] = String(claims['Person.email']).replaceAll('doctor1@acme.org', physicianEmail);
              }
            }
            if (physicianRole) {
              if ('org.schema.Person.hasOccupation.identifier.value' in claims) {
                claims['org.schema.Person.hasOccupation.identifier.value'] = physicianRole;
              }
              if ('Consent.actor-role' in claims) {
                claims['Consent.actor-role'] = physicianRole;
              }
            }
            if (individualControllerRole && 'RelatedPerson.relationship' in claims) {
              claims['RelatedPerson.relationship'] = individualControllerRole;
            }
            if (sectionsAllowed) {
              if ('Consent.action' in claims) {
                claims['Consent.action'] = sectionsAllowed;
              }
              if ('Composition.section' in claims) {
                claims['Composition.section'] = sectionsAllowed;
              }
            }
            if (individualId && 'Consent.subject' in claims && String(claims['Consent.subject']) === 'unified-health-id') {
              claims['Consent.subject'] = individualDid || individualId;
            }
            if (physicianOrg && 'Consent.grantee' in claims) {
              claims['Consent.grantee'] = physicianOrg;
            }
            if (physicianDid) {
              if ('Consent.actor-identifier' in claims) {
                claims['Consent.actor-identifier'] = physicianDid;
              }
              if ('Composition.author' in claims) {
                claims['Composition.author'] = physicianDid;
              }
            }
          }

          for (const [key, value] of Object.entries(node)) {
            if (typeof value === 'string') {
              let nextValue = value;
              if (individualId) nextValue = nextValue.replaceAll('<unified-health-identifier>', individualId);
              if (individualDid) nextValue = nextValue.replaceAll('{CUSTOMER_DID_WEB}', individualDid);
              if (individualControllerDid) nextValue = nextValue.replaceAll('{INDIVIDUAL_CONTROLLER_DID_WEB}', individualControllerDid);
              if (physicianDid) nextValue = nextValue.replaceAll('{PROFESSIONAL_DID_WEB}', physicianDid);
              if (physicianOrg) {
                nextValue = nextValue.replaceAll('{ORGANIZATION_DID_WEB}', physicianOrg);
                nextValue = nextValue.replaceAll('did:web:hospital.example.com', physicianOrg);
              }
              if (individualControllerDid) nextValue = nextValue.replaceAll('{{individualControllerDid}}', individualControllerDid);
              if (individualControllerEmail) nextValue = nextValue.replaceAll('guardian@example.org', individualControllerEmail);
              if (individualControllerRole) nextValue = nextValue.replaceAll('v3-RoleCode|RESPRSN', individualControllerRole);
              if (physicianDid) nextValue = nextValue.replaceAll('{{physicianDid}}', physicianDid);
              if (individualDid && nextValue === 'unified-health-id') nextValue = individualDid;
              if (sectionsAllowed) nextValue = nextValue.replaceAll('LOINC|48765-2', sectionsAllowed);
              if (physicianEmail) nextValue = nextValue.replaceAll('doctor1@acme.org', physicianEmail);
              if (physicianRole) nextValue = nextValue.replaceAll('ISCO-08|2211', physicianRole);
              node[key] = nextValue;
            } else if (value && typeof value === 'object') {
              applyKnownOverrides(value);
            }
          }
        };

        if (typeof request.body === 'string') {
          for (const [token, value] of Object.entries(replacements)) {
            if (value) {
              request.body = request.body.split(token).join(value);
            }
          }
          try {
            const parsed = JSON.parse(request.body);
            applyKnownOverrides(parsed);
            request.body = JSON.stringify(parsed);
          } catch (_) {
            // Keep raw body for non-JSON payloads (e.g., form-encoded secure mode).
          }
        } else if (request.body && typeof request.body === 'object') {
          let serialized = JSON.stringify(request.body);
          for (const [token, value] of Object.entries(replacements)) {
            if (value) {
              serialized = serialized.split(token).join(value);
            }
          }
          request.body = JSON.parse(serialized);
          applyKnownOverrides(request.body);
        }
        return request;
      },
      responseInterceptor: (response: any) => {
        const browser: any = globalThis as any;
        try {
          const contentType =
            response?.headers?.['content-type'] ||
            response?.headers?.['Content-Type'] ||
            '';
          if (!String(contentType).includes('json')) return response;
          const payload = response?.data ?? response?.body ?? response?.text;
          if (!payload) return response;
          const data = typeof payload === 'string' ? JSON.parse(payload) : payload;
          const entries = data?.data || data?.entry;
          if (!Array.isArray(entries)) return response;

          let offerId = '';
          let activationCode = '';
          let licenseId = '';
          for (const entry of entries) {
            const claims = entry?.resource?.meta?.claims;
            if (!claims || typeof claims !== 'object') continue;
            if (!offerId && typeof claims['org.schema.Offer.identifier'] === 'string') {
              offerId = claims['org.schema.Offer.identifier'];
            }
            if (!activationCode && typeof claims['org.schema.IndividualProduct.serialNumber'] === 'string') {
              activationCode = claims['org.schema.IndividualProduct.serialNumber'];
            }
            if (!licenseId && typeof claims['org.schema.Offer.serialNumber'] === 'string') {
              licenseId = claims['org.schema.Offer.serialNumber'].split(',')[0]?.trim();
            }
          }

          if (browser?.localStorage?.setItem) {
            if (offerId) browser.localStorage.setItem('gw-api-docs:offerId', offerId);
            if (activationCode) browser.localStorage.setItem('gw-api-docs:activationCode', activationCode);
            if (licenseId) browser.localStorage.setItem('gw-api-docs:licenseId', licenseId);
            if (browser.__gwApiDocsStore) {
              if (offerId) browser.__gwApiDocsStore.set('offerId', offerId);
              if (activationCode) browser.__gwApiDocsStore.set('activationCode', activationCode);
              if (licenseId) browser.__gwApiDocsStore.set('licenseId', licenseId);
            }
          }
        } catch (_) {
          // Ignore interceptor parsing errors: responses can be non-JSON in secure mode.
        }
        return response;
      },
      persistAuthorization: true,
    },
    customJsStr: globalContextScript,
  };
}
