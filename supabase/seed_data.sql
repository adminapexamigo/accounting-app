-- ====================================================================
-- AMIGO ACCOUNTING APP - DATA MIGRATION SEED SCRIPT
-- 100% of data from local CSV and JSON files
-- Safe: Uses ON CONFLICT DO UPDATE so it can be re-run safely
-- ====================================================================

-- 1. USERS (2 records)
INSERT INTO public.users (id, username, full_name, password, role, designation, contact, email, photo, face_descriptor, face_required, otp_required, created_at)
VALUES ('8b61855ec159', 'admin', 'Kuldeep', '2c14aa1b300f215b64b639048e7c3dd0:6a39020785feee69c5a49e1edd077a6440c575be369a9a064f0c29840fad11da6078cdb488dbd69e9281d0a2214248d5e48382a84635a22585ce6336fc8b8e4a', 'admin', 'Accountant Admin', '7350698586', 'udamale107@gmail.com', '', NULL, '', '', '2026-10-18T15:59:41.864Z')
ON CONFLICT (id) DO UPDATE SET username=EXCLUDED.username, full_name=EXCLUDED.full_name, password=EXCLUDED.password, role=EXCLUDED.role, designation=EXCLUDED.designation, contact=EXCLUDED.contact, email=EXCLUDED.email;
INSERT INTO public.users (id, username, full_name, password, role, designation, contact, email, photo, face_descriptor, face_required, otp_required, created_at)
VALUES ('ff9deb24622c', 'Sangram', 'Sangram', 'b0720e3033127b754687981862701ebf:f94ce48b2c537c70247ea7ab9104082434025355b772c78c42e60863abdbc9266d8fe8e1feb809c64334f9b64f472520ac48ee6d8992bd9f403bbfc455ac8818', 'employee', 'Sales Executive', '7350698586', 'budamale7@gmail.com', '', NULL, '', '', '2026-11-01T13:18:23.182Z')
ON CONFLICT (id) DO UPDATE SET username=EXCLUDED.username, full_name=EXCLUDED.full_name, password=EXCLUDED.password, role=EXCLUDED.role, designation=EXCLUDED.designation, contact=EXCLUDED.contact, email=EXCLUDED.email;

-- 2. CLIENTS (1 records)
INSERT INTO public.clients (id, name, email, phone, address, gstin, contact, mobile, created_at)
VALUES ('8d44eebf6c99', 'ABC', '689', '165', '', '', '', '', '2026-10-18T16:05:34.510Z')
ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, email=EXCLUDED.email, phone=EXCLUDED.phone, address=EXCLUDED.address, gstin=EXCLUDED.gstin, contact=EXCLUDED.contact, mobile=EXCLUDED.mobile;

-- 3. PRODUCTS (1 records)
INSERT INTO public.products (id, name, hsn, rate, gst, created_at)
VALUES ('aeb153122427', 'sdqjduqdq', 'qdqdmb', 25, 15, '2026-10-18T16:05:53.494Z')
ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, hsn=EXCLUDED.hsn, rate=EXCLUDED.rate, gst=EXCLUDED.gst;

-- 4. INVOICES (9 records)
INSERT INTO public.invoices (id, number, date, state, tax_type, client_id, client_name, client_address, client_gstin, client_contact, client_mobile, ship_name, ship_address, ship_gstin, ship_contact, ship_mobile, po_number, po_date, items, subtotal, tax, total, created_by, created_at)
VALUES ('11297d445fdf', 'INV-2026-0001', '2026-10-18', 'Maharashtra 27', '', '8d44eebf6c99', 'ABC', '', '', '', '', 'ABC', '', '', '', '', '', '', '[{"name":"sdqjduqdq","hsn":"qdqdmb","qty":1,"unit":"Nos","rate":25,"gst":15,"amount":25},{"name":"sdqjduqdq","hsn":"qdqdmb","qty":1,"unit":"Nos","rate":25,"gst":15,"amount":25}]'::jsonb, 50, 7.5, 57.5, 'admin', '2026-10-18T17:56:29.482Z')
ON CONFLICT (id) DO UPDATE SET number=EXCLUDED.number, total=EXCLUDED.total, items=EXCLUDED.items, subtotal=EXCLUDED.subtotal, tax=EXCLUDED.tax;
INSERT INTO public.invoices (id, number, date, state, tax_type, client_id, client_name, client_address, client_gstin, client_contact, client_mobile, ship_name, ship_address, ship_gstin, ship_contact, ship_mobile, po_number, po_date, items, subtotal, tax, total, created_by, created_at)
VALUES ('16b3370299bf', 'INV-26-27/1', '2026-10-19', 'Maharashtra 27', '', '8d44eebf6c99', 'ABC', '', '', '', '', 'ABC', '', '', '', '', '', '', '[{"name":"sdqjduqdq","hsn":"qdqdmb","qty":1,"unit":"Nos","rate":255,"gst":15,"amount":255}]'::jsonb, 255, 38.25, 293.25, 'Sangram', '2026-10-19T09:01:37.387Z')
ON CONFLICT (id) DO UPDATE SET number=EXCLUDED.number, total=EXCLUDED.total, items=EXCLUDED.items, subtotal=EXCLUDED.subtotal, tax=EXCLUDED.tax;
INSERT INTO public.invoices (id, number, date, state, tax_type, client_id, client_name, client_address, client_gstin, client_contact, client_mobile, ship_name, ship_address, ship_gstin, ship_contact, ship_mobile, po_number, po_date, items, subtotal, tax, total, created_by, created_at)
VALUES ('f97a39582991', 'INV-26-27/2', '2026-10-23', 'Maharashtra 27', '', '8d44eebf6c99', 'ABC', '', '', '', '', 'ABC', '', '', '', '', '', '', '[{"name":"sdqjduqdq","hsn":"qdqdmb","qty":1,"unit":"Nos","rate":25,"gst":18,"amount":25}]'::jsonb, 25, 4.5, 29.5, 'Sangram', '2026-10-23T11:11:12.356Z')
ON CONFLICT (id) DO UPDATE SET number=EXCLUDED.number, total=EXCLUDED.total, items=EXCLUDED.items, subtotal=EXCLUDED.subtotal, tax=EXCLUDED.tax;
INSERT INTO public.invoices (id, number, date, state, tax_type, client_id, client_name, client_address, client_gstin, client_contact, client_mobile, ship_name, ship_address, ship_gstin, ship_contact, ship_mobile, po_number, po_date, items, subtotal, tax, total, created_by, created_at)
VALUES ('3e3db46318e0', 'INV-26-27/3', '2026-10-25', 'Maharashtra 27', '', '8d44eebf6c99', 'ABC', '', '', '', '', 'ABC', 'jbdbk', 'KERLA', '75651', '445', '', '', '[{"name":"sdqjduqdq","hsn":"qdqdmb","qty":1,"unit":"Nos","rate":25,"gst":18,"amount":25}]'::jsonb, 25, 4.5, 29.5, 'admin', '2026-10-25T03:04:21.753Z')
ON CONFLICT (id) DO UPDATE SET number=EXCLUDED.number, total=EXCLUDED.total, items=EXCLUDED.items, subtotal=EXCLUDED.subtotal, tax=EXCLUDED.tax;
INSERT INTO public.invoices (id, number, date, state, tax_type, client_id, client_name, client_address, client_gstin, client_contact, client_mobile, ship_name, ship_address, ship_gstin, ship_contact, ship_mobile, po_number, po_date, items, subtotal, tax, total, created_by, created_at)
VALUES ('37183e7fb656', 'INV-26-27/4', '2026-10-25', 'Maharashtra 27', 'IGST', '8d44eebf6c99', 'ABC', '', '', '', '', 'ABC', '', '', '', '', 'aa', '2026-10-15', '[{"name":"sdqjduqdq","hsn":"qdqdmb","qty":1,"unit":"Nos","rate":25,"gst":18,"amount":25}]'::jsonb, 25, 4.5, 29.5, 'admin', '2026-10-25T03:07:47.410Z')
ON CONFLICT (id) DO UPDATE SET number=EXCLUDED.number, total=EXCLUDED.total, items=EXCLUDED.items, subtotal=EXCLUDED.subtotal, tax=EXCLUDED.tax;
INSERT INTO public.invoices (id, number, date, state, tax_type, client_id, client_name, client_address, client_gstin, client_contact, client_mobile, ship_name, ship_address, ship_gstin, ship_contact, ship_mobile, po_number, po_date, items, subtotal, tax, total, created_by, created_at)
VALUES ('d174ac200680', 'INV-26-27/5', '2026-10-30', 'Maharashtra 27', 'CGST+SGST', '8d44eebf6c99', 'ABC', '', '', '', '', 'ABC', '', '', '', '', '1564136846', '2026-10-31', '[{"name":"sdqjduqdq","hsn":"qdqdmb","qty":1,"unit":"Nos","rate":25,"gst":15,"amount":25}]'::jsonb, 25, 3.75, 28.75, 'admin', '2026-10-30T09:45:35.080Z')
ON CONFLICT (id) DO UPDATE SET number=EXCLUDED.number, total=EXCLUDED.total, items=EXCLUDED.items, subtotal=EXCLUDED.subtotal, tax=EXCLUDED.tax;
INSERT INTO public.invoices (id, number, date, state, tax_type, client_id, client_name, client_address, client_gstin, client_contact, client_mobile, ship_name, ship_address, ship_gstin, ship_contact, ship_mobile, po_number, po_date, items, subtotal, tax, total, created_by, created_at)
VALUES ('a5c258f582dc', 'INV-26-27/6', '2026-11-01', 'Maharashtra 27', 'CGST+SGST', '8d44eebf6c99', 'ABC', '', '', '', '', 'ABC', '', '', '', '', '', '', '[{"name":"sdqjduqdq","hsn":"qdqdmb","qty":1,"unit":"Nos","rate":25,"gst":15,"amount":25}]'::jsonb, 25, 3.75, 28.75, 'admin', '2026-11-01T18:29:59.297Z')
ON CONFLICT (id) DO UPDATE SET number=EXCLUDED.number, total=EXCLUDED.total, items=EXCLUDED.items, subtotal=EXCLUDED.subtotal, tax=EXCLUDED.tax;
INSERT INTO public.invoices (id, number, date, state, tax_type, client_id, client_name, client_address, client_gstin, client_contact, client_mobile, ship_name, ship_address, ship_gstin, ship_contact, ship_mobile, po_number, po_date, items, subtotal, tax, total, created_by, created_at)
VALUES ('e6e4ad04fa99', 'INV-26-27/7', '2026-11-02', 'Maharashtra 27', 'IGST', '8d44eebf6c99', 'ABC', '', '', '', '', 'asadAD', 'asdadads', 'asdadsaDadAD', 'asfQR', 'esWEGWe', '1564136846', '2026-11-03', '[{"name":"sdqjduqdq","hsn":"qdqdmb","qty":1,"unit":"Nos","rate":25,"gst":15,"amount":25},{"name":"sdqjduqdq","hsn":"qdqdmb","qty":1,"unit":"Nos","rate":25,"gst":15,"amount":25},{"name":"sdqjduqdq","hsn":"qdqdmb","qty":1,"unit":"Nos","rate":25,"gst":15,"amount":25},{"name":"sdqjduqdq","hsn":"qdqdmb","qty":1,"unit":"Nos","rate":25,"gst":15,"amount":25},{"name":"sdqjduqdq","hsn":"qdqdmb","qty":1,"unit":"Nos","rate":25,"gst":15,"amount":25},{"name":"sdqjduqdq","hsn":"qdqdmb","qty":1,"unit":"Nos","rate":25,"gst":15,"amount":25}]'::jsonb, 150, 22.5, 172.5, 'admin', '2026-11-01T18:34:29.382Z')
ON CONFLICT (id) DO UPDATE SET number=EXCLUDED.number, total=EXCLUDED.total, items=EXCLUDED.items, subtotal=EXCLUDED.subtotal, tax=EXCLUDED.tax;
INSERT INTO public.invoices (id, number, date, state, tax_type, client_id, client_name, client_address, client_gstin, client_contact, client_mobile, ship_name, ship_address, ship_gstin, ship_contact, ship_mobile, po_number, po_date, items, subtotal, tax, total, created_by, created_at)
VALUES ('88a0b046de51', 'INV-26-27/8', '2026-11-02', 'Maharashtra 27', 'CGST+SGST', '8d44eebf6c99', 'ABC', '', '', '', '', 'ABC', '', '', '', '', '', '', '[{"name":"sdqjduqdq","hsn":"qdqdmb","qty":1,"unit":"Nos","rate":25,"gst":15,"amount":25}]'::jsonb, 25, 3.75, 28.75, 'admin', '2026-11-01T18:37:37.590Z')
ON CONFLICT (id) DO UPDATE SET number=EXCLUDED.number, total=EXCLUDED.total, items=EXCLUDED.items, subtotal=EXCLUDED.subtotal, tax=EXCLUDED.tax;

-- 5. DOCUMENTS (4 records)
INSERT INTO public.docs (id, type, number, date, party, total, data, created_by, created_at)
VALUES ('0ca1726ef451', 'po', 'AE/26-27/1', '2026-10-19', 'ABC', 5396.06, '{"toName":"ABC","toAddress":"/9786","toGstin":"96","toContact":"0L.","toPhone":"165","payment":"100% Against PI","items":[{"desc":"HKGC","qty":"1","uom":"Nos","rate":15,"disc":"1","pf":"5","delivery":"As earliest as possible","amount":19.85},{"desc":"ASFAS","qty":"1","uom":"Nos","rate":4646,"disc":"2","pf":"WEGA","delivery":"As earliest as possible","amount":4553.08}],"total":4572.93,"taxType":"IGST","taxRate":18,"taxAmount":823.13,"payable":5396.06}'::jsonb, 'admin', '2026-10-19T10:18:02.036Z')
ON CONFLICT (id) DO UPDATE SET type=EXCLUDED.type, number=EXCLUDED.number, total=EXCLUDED.total, data=EXCLUDED.data;
INSERT INTO public.docs (id, type, number, date, party, total, data, created_by, created_at)
VALUES ('61feee566a89', 'pi', 'AEPI-26-27-001', '2026-10-19', 'ABC', 29.5, '{"toName":"ABC","toAddress":"iyvp","toGstin":"iobuiyv","toContact":"lkj","toPhone":"165","poNo":"65446","poDate":"","items":[{"desc":"eww","qty":"1","uom":"Nos","rate":25,"disc":"sater","pf":"wetw","delivery":"25","amount":25}],"total":25,"taxType":"IGST","taxRate":18,"taxAmount":4.5,"payable":29.5}'::jsonb, 'admin', '2026-10-19T10:16:41.896Z')
ON CONFLICT (id) DO UPDATE SET type=EXCLUDED.type, number=EXCLUDED.number, total=EXCLUDED.total, data=EXCLUDED.data;
INSERT INTO public.docs (id, type, number, date, party, total, data, created_by, created_at)
VALUES ('0ca1726ef451', 'po', 'AE/26-27/1', '2026-10-19', 'ABC', 5396.06, '{"toName":"ABC","toAddress":"/9786","toGstin":"96","toContact":"0L.","toPhone":"165","payment":"100% Against PI","items":[{"desc":"HKGC","qty":"1","uom":"Nos","rate":15,"disc":"1","pf":"5","delivery":"As earliest as possible","amount":19.85},{"desc":"ASFAS","qty":"1","uom":"Nos","rate":4646,"disc":"2","pf":"WEGA","delivery":"As earliest as possible","amount":4553.08}],"total":4572.93,"taxType":"IGST","taxRate":18,"taxAmount":823.13,"payable":5396.06}'::jsonb, 'admin', '2026-10-19T10:18:02.036Z')
ON CONFLICT (id) DO UPDATE SET type=EXCLUDED.type, number=EXCLUDED.number, total=EXCLUDED.total, data=EXCLUDED.data;
INSERT INTO public.docs (id, type, number, date, party, total, data, created_by, created_at)
VALUES ('2525450b1ddf', 'quotation', 'AE/26-27/1', '2026-10-27', 'ABC', 0, '{"toName":"ABC","attn":"","ref":"","subject":"","intro":"We thank you for your ref. enquiry for subject matter. We are pleased to submit our most competitive offer as below.","terms":"Price :-Ex work Pune .\nPacking :- Charges 2%\nDuties Taxes :- GST @ 18% extra\nPayment Terms :- 30% Advance with PO and 70% Against PI readiness of material\nDelivery :- 2-3weeks\nFreight :- To Pay Basis\nValidity :- This offer is valid for 15 days from date of quotation.\nService engineer and workers Loading & boarding is in customer scope.","sign":"Kuldeep Ranbawale\n08605069145\nAmigo Enterprises,Pune\nkuldeep.amigo@gmail.com","items":[{"desc":"b djlfjvdflbdfhjdf","qty":"1","rate":0,"amount":0}],"total":0}'::jsonb, 'admin', '2026-10-27T09:34:48.599Z')
ON CONFLICT (id) DO UPDATE SET type=EXCLUDED.type, number=EXCLUDED.number, total=EXCLUDED.total, data=EXCLUDED.data;

-- 6. LEDGERS (14 records)
INSERT INTO public.ledgers (id, name, ledger_group, opening_balance, balance_type, contact, phone, gstin, address, created_by, created_at)
VALUES ('a86832059dc5', 'Cash', 'Cash-in-Hand', 0, 'Dr', '', '', '', '', 'system', '2026-10-25T03:58:58.721Z')
ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, ledger_group=EXCLUDED.ledger_group, opening_balance=EXCLUDED.opening_balance, balance_type=EXCLUDED.balance_type;
INSERT INTO public.ledgers (id, name, ledger_group, opening_balance, balance_type, contact, phone, gstin, address, created_by, created_at)
VALUES ('a248d4295f0a', 'Bank Account (State Bank of India)', 'Bank Accounts', 0, 'Dr', '', '', '', '', 'system', '2026-10-25T03:58:58.735Z')
ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, ledger_group=EXCLUDED.ledger_group, opening_balance=EXCLUDED.opening_balance, balance_type=EXCLUDED.balance_type;
INSERT INTO public.ledgers (id, name, ledger_group, opening_balance, balance_type, contact, phone, gstin, address, created_by, created_at)
VALUES ('09872221b00a', 'Sales Account', 'Sales Accounts', 0, 'Cr', '', '', '', '', 'system', '2026-10-25T03:58:58.735Z')
ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, ledger_group=EXCLUDED.ledger_group, opening_balance=EXCLUDED.opening_balance, balance_type=EXCLUDED.balance_type;
INSERT INTO public.ledgers (id, name, ledger_group, opening_balance, balance_type, contact, phone, gstin, address, created_by, created_at)
VALUES ('9955d995f65e', 'Purchase Account', 'Purchase Accounts', 0, 'Dr', '', '', '', '', 'system', '2026-10-25T03:58:58.735Z')
ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, ledger_group=EXCLUDED.ledger_group, opening_balance=EXCLUDED.opening_balance, balance_type=EXCLUDED.balance_type;
INSERT INTO public.ledgers (id, name, ledger_group, opening_balance, balance_type, contact, phone, gstin, address, created_by, created_at)
VALUES ('8df0b42c9fae', 'Capital Account', 'Capital Account', 0, 'Cr', '', '', '', '', 'system', '2026-10-25T03:58:58.735Z')
ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, ledger_group=EXCLUDED.ledger_group, opening_balance=EXCLUDED.opening_balance, balance_type=EXCLUDED.balance_type;
INSERT INTO public.ledgers (id, name, ledger_group, opening_balance, balance_type, contact, phone, gstin, address, created_by, created_at)
VALUES ('3f59085ed9de', 'Sundry Debtors', 'Sundry Debtors', 0, 'Dr', '', '', '', '', 'system', '2026-10-25T03:58:58.735Z')
ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, ledger_group=EXCLUDED.ledger_group, opening_balance=EXCLUDED.opening_balance, balance_type=EXCLUDED.balance_type;
INSERT INTO public.ledgers (id, name, ledger_group, opening_balance, balance_type, contact, phone, gstin, address, created_by, created_at)
VALUES ('b4d00882d561', 'Sundry Creditors', 'Sundry Creditors', 0, 'Cr', '', '', '', '', 'system', '2026-10-25T03:58:58.735Z')
ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, ledger_group=EXCLUDED.ledger_group, opening_balance=EXCLUDED.opening_balance, balance_type=EXCLUDED.balance_type;
INSERT INTO public.ledgers (id, name, ledger_group, opening_balance, balance_type, contact, phone, gstin, address, created_by, created_at)
VALUES ('b466761cd015', 'CGST (Duties & Taxes)', 'Duties & Taxes', 0, 'Cr', '', '', '', '', 'system', '2026-10-25T03:58:58.735Z')
ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, ledger_group=EXCLUDED.ledger_group, opening_balance=EXCLUDED.opening_balance, balance_type=EXCLUDED.balance_type;
INSERT INTO public.ledgers (id, name, ledger_group, opening_balance, balance_type, contact, phone, gstin, address, created_by, created_at)
VALUES ('3ea78d7b11b5', 'SGST (Duties & Taxes)', 'Duties & Taxes', 0, 'Cr', '', '', '', '', 'system', '2026-10-25T03:58:58.735Z')
ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, ledger_group=EXCLUDED.ledger_group, opening_balance=EXCLUDED.opening_balance, balance_type=EXCLUDED.balance_type;
INSERT INTO public.ledgers (id, name, ledger_group, opening_balance, balance_type, contact, phone, gstin, address, created_by, created_at)
VALUES ('415bb94f3ccf', 'IGST (Duties & Taxes)', 'Duties & Taxes', 0, 'Cr', '', '', '', '', 'system', '2026-10-25T03:58:58.735Z')
ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, ledger_group=EXCLUDED.ledger_group, opening_balance=EXCLUDED.opening_balance, balance_type=EXCLUDED.balance_type;
INSERT INTO public.ledgers (id, name, ledger_group, opening_balance, balance_type, contact, phone, gstin, address, created_by, created_at)
VALUES ('6d7b2a7b79db', 'Freight & Site Work Expenses', 'Direct Expenses', 0, 'Dr', '', '', '', '', 'system', '2026-10-25T03:58:58.735Z')
ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, ledger_group=EXCLUDED.ledger_group, opening_balance=EXCLUDED.opening_balance, balance_type=EXCLUDED.balance_type;
INSERT INTO public.ledgers (id, name, ledger_group, opening_balance, balance_type, contact, phone, gstin, address, created_by, created_at)
VALUES ('69dfaba1b3d7', 'Office Rent & Utilities', 'Indirect Expenses', 0, 'Dr', '', '', '', '', 'system', '2026-10-25T03:58:58.735Z')
ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, ledger_group=EXCLUDED.ledger_group, opening_balance=EXCLUDED.opening_balance, balance_type=EXCLUDED.balance_type;
INSERT INTO public.ledgers (id, name, ledger_group, opening_balance, balance_type, contact, phone, gstin, address, created_by, created_at)
VALUES ('031ac1fe9e2c', 'Staff Salaries', 'Indirect Expenses', 0, 'Dr', '', '', '', '', 'system', '2026-10-25T03:58:58.735Z')
ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, ledger_group=EXCLUDED.ledger_group, opening_balance=EXCLUDED.opening_balance, balance_type=EXCLUDED.balance_type;
INSERT INTO public.ledgers (id, name, ledger_group, opening_balance, balance_type, contact, phone, gstin, address, created_by, created_at)
VALUES ('adf4ec5b9790', 'First', 'Cash-in-Hand', 25550, 'Dr', 'Kuldeep', '73506 98586', '', '', 'admin', '2026-10-25T04:11:37.609Z')
ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, ledger_group=EXCLUDED.ledger_group, opening_balance=EXCLUDED.opening_balance, balance_type=EXCLUDED.balance_type;

-- 7. LOGINS (75 records)
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('14849058d3c4', 'cab28735affd', 'Sangram', '2026-10-19T05:06:19.513Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('2a978592418b', '8b61855ec159', 'admin', '2026-10-19T05:07:45.617Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('5ff6326afad3', '8b61855ec159', 'admin', '2026-10-19T05:37:58.288Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('f65e37e53ad1', '8b61855ec159', 'admin', '2026-10-19T05:41:45.271Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('e2d472b3eab7', '8b61855ec159', 'admin', '2026-10-19T08:56:39.567Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('907f982c8719', 'cab28735affd', 'Sangram', '2026-10-19T08:58:28.237Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('2c76cae3d1ec', '8b61855ec159', 'admin', '2026-10-19T09:09:38.117Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('a973405816ee', '8b61855ec159', 'admin', '2026-10-19T10:13:55.438Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('9b826b9855f5', 'cab28735affd', 'Sangram', '2026-10-19T10:19:14.657Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('549701b1203b', 'cab28735affd', 'Sangram', '2026-10-21T05:57:32.348Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('1c37be3aa0b3', '8b61855ec159', 'admin', '2026-10-22T09:59:58.785Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('6ad477ff2bad', '8b61855ec159', 'admin', '2026-10-22T10:02:09.011Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('0a2cf6bfd5a0', 'cab28735affd', 'Sangram', '2026-10-22T10:06:35.293Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('b1b884125912', 'cab28735affd', 'Sangram', '2026-10-22T23:17:56.517Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('0c6c13184b10', 'cab28735affd', 'Sangram', '2026-10-22T23:24:16.101Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('00062da30aa5', '8b61855ec159', 'admin', '2026-10-22T23:28:11.357Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('29ec7164d03f', '8b61855ec159', 'admin', '2026-10-22T23:36:01.402Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('741584fa7ba1', '8b61855ec159', 'admin', '2026-10-22T23:37:18.277Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('452b7d6eb609', '8b61855ec159', 'admin', '2026-10-23T05:01:54.632Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('cb9c462a73a6', '8b61855ec159', 'admin', '2026-10-23T05:02:43.742Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('da543cc94c3c', '8b61855ec159', 'admin', '2026-10-23T05:04:43.586Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('0754081ec62e', 'cab28735affd', 'Sangram', '2026-10-23T11:10:46.139Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('8ab7db13933d', '8b61855ec159', 'admin', '2026-10-25T02:47:40.733Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('e0769a3d4373', '8b61855ec159', 'admin', '2026-10-25T02:53:47.758Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('322ff415ed8e', 'cab28735affd', 'Sangram', '2026-10-25T02:55:02.025Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('3d9bd56100ba', '8b61855ec159', 'admin', '2026-10-25T03:03:50.949Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('5d6764bd1ac8', '8b61855ec159', 'admin', '2026-10-25T03:07:29.890Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('895a83e4eddf', '8b61855ec159', 'admin', '2026-10-25T03:21:23.674Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('9d85c00ba552', '8b61855ec159', 'admin', '2026-10-25T03:25:32.427Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('b261a668cdc9', '8b61855ec159', 'admin', '2026-10-25T03:28:20.163Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('6880443b6a00', '8b61855ec159', 'admin', '2026-10-25T03:50:03.490Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('72dfac396ef8', 'cab28735affd', 'Sangram', '2026-10-25T03:52:18.096Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('4fa1dc1141e0', '8b61855ec159', 'admin', '2026-10-25T04:00:16.074Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('42026f2ac03e', '8b61855ec159', 'admin', '2026-10-25T04:07:03.607Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('da9fbdb8b6a3', '8b61855ec159', 'admin', '2026-10-25T04:15:12.830Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('7ba39fe093c8', 'cab28735affd', 'Sangram', '2026-10-25T04:17:00.018Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('cfdc5f7d0ac2', '8b61855ec159', 'admin', '2026-10-25T05:05:30.649Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('16df3404cebb', '8b61855ec159', 'admin', '2026-10-25T05:06:54.222Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('0d9b16ce94c8', 'cab28735affd', 'Sangram', '2026-10-25T05:09:24.508Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('e8321e8f104e', '8b61855ec159', 'admin', '2026-10-25T05:30:22.089Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('f39d7c8fbdb1', '8b61855ec159', 'admin', '2026-10-25T06:03:09.401Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('2c77e32ce95c', '8b61855ec159', 'admin', '2026-10-25T06:08:48.417Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('9b4215179eda', '8b61855ec159', 'admin', '2026-10-25T06:13:36.969Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('0de0f3220344', '8b61855ec159', 'admin', '2026-10-25T09:19:04.764Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('89a375b2492a', '8b61855ec159', 'admin', '2026-10-27T09:29:57.784Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('5fc2f3a694b4', '8b61855ec159', 'admin', '2026-10-30T09:28:08.444Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('1f94ffef584f', '8b61855ec159', 'admin', '2026-10-30T09:44:40.796Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('17008c9c636b', '8b61855ec159', 'admin', '2026-10-30T09:56:14.593Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('1b57a2ba31a6', '8b61855ec159', 'admin', '2026-10-30T10:06:56.929Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('cacf0d23fc6f', '8b61855ec159', 'admin', '2026-10-30T10:16:32.610Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('9b9c93171ab4', '8b61855ec159', 'admin', '2026-10-30T10:29:05.661Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('17845292edbd', '8b61855ec159', 'admin', '2026-10-30T10:54:49.495Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('6673c6efd48a', '8b61855ec159', 'admin', '2026-10-30T11:22:17.437Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('9b32f379388b', '8b61855ec159', 'admin', '2026-10-30T11:24:32.478Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('27013d265764', '8b61855ec159', 'admin', '2026-11-01T10:07:28.410Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('12f55301b480', '8b61855ec159', 'admin', '2026-11-01T11:53:03.242Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('95c55a6259b9', '8b61855ec159', 'admin', '2026-11-01T12:00:14.399Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('b6206f001975', '8b61855ec159', 'admin', '2026-11-01T12:15:25.041Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('c31657147d7e', '8b61855ec159', 'admin', '2026-11-01T12:33:54.195Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('80aed85a2cb4', '8b61855ec159', 'admin', '2026-11-01T13:00:31.392Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('bf6b6e93bf2e', '8b61855ec159', 'admin', '2026-11-01T13:12:49.299Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('b6186d2930f7', '8b61855ec159', 'admin', '2026-11-01T13:19:48.315Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('26443ba14049', 'ff9deb24622c', 'Sangram', '2026-11-01T13:20:45.960Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('09fb1c9e579b', '8b61855ec159', 'admin', '2026-11-01T13:22:36.219Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('98e77d2208b7', '8b61855ec159', 'admin', '2026-11-01T13:24:02.930Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('550580d4c397', '8b61855ec159', 'admin', '2026-11-01T16:21:02.549Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('299da6ea7db9', '8b61855ec159', 'admin', '2026-11-01T16:47:24.370Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('2dfbf2f9f7e4', '8b61855ec159', 'admin', '2026-11-03T03:58:17.708Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('a25b379db1ad', '8b61855ec159', 'admin', '2026-11-03T04:08:35.017Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('0b099d7d45ce', '8b61855ec159', 'admin', '2026-11-03T04:31:07.043Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('89189db27b46', '8b61855ec159', 'admin', '2026-11-03T04:35:41.366Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('6bc2be4a42e5', '8b61855ec159', 'admin', '2026-11-03T04:39:36.667Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('e7b12dda7bcc', '8b61855ec159', 'admin', '2026-11-03T05:00:14.711Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('8333b5e47115', '8b61855ec159', 'admin', '2026-11-03T05:15:53.956Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;
INSERT INTO public.logins (id, user_id, username, login_at)
VALUES ('956498970a3d', '8b61855ec159', 'admin', '2026-11-03T06:03:37.364Z')
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;

-- 8. APP SETTINGS (Company, Mail, Monitoring, Sync)
INSERT INTO public.app_settings (key, value, updated_at)
VALUES ('company', '{
  "name": "AMIGO ENTERPRISES",
  "address": "S.NO.6/17 FLAT NO 401 CHOVISAWADI Pimpri Chinchwad, Pune, Maharashtra, 412105",
  "gstin": "27ACBFA5336L1ZB",
  "state": "Maharashtra",
  "stateCode": "27",
  "prefix": "INV",
  "terms": "1. This is an electronically generated document.\n2. All disputes are subject to Pune jurisdiction.",
  "docAddress": "office No. 401, Baban Villa, S\nNo. 6/17, Chovisawadi\nPune - 412105 Maharashtra\nIndia",
  "contactPhone": "08605069145",
  "contactEmail": "kuldeep.amigo@gmail.com",
  "pan": "ACBFA5336L",
  "bankName": "HDFC",
  "bankBranch": "Chovisawadi, Charoli BK, Pune-412105 Maharashtra.",
  "bankAcc": "50200081185029",
  "bankIfsc": "HDFC0009467",
  "quoteHeader": "Office No:- 401, Baban Villa, Sno-6/17, Chovisawadi, Haveli Pune, Pimpri Chinchwad (M Corp.) 412105\nGmail : kuldeep.amigo@gmail.com\nMo No. 08605069145",
  "quoteTerms": "Price :-Ex work Pune .\nPacking :- Charges 2%\nDuties Taxes :- GST @ 18% extra\nPayment Terms :- 30% Advance with PO and 70% Against PI readiness of material\nDelivery :- 2-3weeks\nFreight :- To Pay Basis\nValidity :- This offer is valid for 15 days from date of quotation.\nService engineer and workers Loading & boarding is in customer scope.",
  "quoteSign": "Kuldeep Ranbawale\n08605069145\nAmigo Enterprises,Pune\nkuldeep.amigo@gmail.com",
  "poPayment": "100% Against PI",
  "quotePrefix": "AE/",
  "piPrefix": "AEPI-",
  "poPrefix": "AE/",
  "groqApiKey": "",
  "groqModel": "openai/gpt-oss-120b",
  "stamp": ""
}'::jsonb, NOW())
ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW();
INSERT INTO public.app_settings (key, value, updated_at)
VALUES ('mail', '{
  "smtpHost": "smtp.gmail.com",
  "smtpPort": 465,
  "smtpSecure": true,
  "smtpUser": "budamale7@gmail.com",
  "smtpPass": "",
  "mailTo": "budamale7@gmail.com",
  "alertTime": "17:30",
  "otpAdmin": true
}'::jsonb, NOW())
ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW();
INSERT INTO public.app_settings (key, value, updated_at)
VALUES ('monitoring', '{
  "enabled": true,
  "workDays": [
    "Mon",
    "Tue",
    "Wed",
    "Thu",
    "Fri",
    "Sat"
  ],
  "workStartTime": "09:30",
  "workEndTime": "18:30",
  "lunchStartTime": "13:00",
  "lunchEndTime": "14:00",
  "offlineThresholdMins": 90,
  "alertEmails": "",
  "holidays": [
    {
      "id": "h-2026-01-26",
      "date": "2026-01-26",
      "name": "Republic Day"
    },
    {
      "id": "h-2026-03-03",
      "date": "2026-03-03",
      "name": "Holi"
    },
    {
      "id": "h-2026-03-20",
      "date": "2026-03-20",
      "name": "Eid-ul-Fitr"
    },
    {
      "id": "h-2026-04-03",
      "date": "2026-04-03",
      "name": "Good Friday"
    },
    {
      "id": "h-2026-04-14",
      "date": "2026-04-14",
      "name": "Dr. Ambedkar Jayanti"
    },
    {
      "id": "h-2026-05-01",
      "date": "2026-05-01",
      "name": "Maharashtra Day / Labour Day"
    },
    {
      "id": "h-2026-05-27",
      "date": "2026-05-27",
      "name": "Bakrid / Eid al-Adha"
    },
    {
      "id": "h-2026-08-15",
      "date": "2026-08-15",
      "name": "Independence Day"
    },
    {
      "id": "h-2026-08-28",
      "date": "2026-08-28",
      "name": "Raksha Bandhan"
    },
    {
      "id": "h-2026-09-04",
      "date": "2026-09-04",
      "name": "Janmashtami"
    },
    {
      "id": "h-2026-09-14",
      "date": "2026-09-14",
      "name": "Ganesh Chaturthi"
    },
    {
      "id": "h-2026-10-02",
      "date": "2026-10-02",
      "name": "Mahatma Gandhi Jayanti"
    },
    {
      "id": "h-2026-10-20",
      "date": "2026-10-20",
      "name": "Dussehra / Vijayadashami"
    },
    {
      "id": "h-2026-11-08",
      "date": "2026-11-08",
      "name": "Diwali (Lakshmi Pujan)"
    },
    {
      "id": "h-2026-11-09",
      "date": "2026-11-09",
      "name": "Diwali Balipratipada / New Year"
    },
    {
      "id": "h-2026-11-24",
      "date": "2026-11-24",
      "name": "Guru Nanak Jayanti"
    },
    {
      "id": "h-2026-12-25",
      "date": "2026-12-25",
      "name": "Christmas"
    }
  ]
}'::jsonb, NOW())
ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW();
INSERT INTO public.app_settings (key, value, updated_at)
VALUES ('sync', '{
  "lastSyncAt": "2026-10-25T09:20:01.599Z",
  "syncedBy": "admin",
  "lastEmailedAt": "2026-11-01T13:21:43.834Z",
  "emailedBy": "Sangram",
  "history": [
    {
      "at": "2026-11-01T13:21:43.834Z",
      "by": "Sangram",
      "action": "email",
      "recipient": "budamale7@gmail.com",
      "size": 6119
    },
    {
      "at": "2026-10-25T09:20:01.599Z",
      "by": "admin",
      "action": "import",
      "stats": [
        {
          "table": "users",
          "added": 0,
          "updated": 2,
          "total": 2
        },
        {
          "table": "clients",
          "added": 0,
          "updated": 1,
          "total": 1
        },
        {
          "table": "products",
          "added": 0,
          "updated": 1,
          "total": 1
        },
        {
          "table": "invoices",
          "added": 0,
          "updated": 5,
          "total": 5
        },
        {
          "table": "purchases",
          "added": 0,
          "updated": 0,
          "total": 0
        },
        {
          "table": "workupdates",
          "added": 0,
          "updated": 3,
          "total": 3
        },
        {
          "table": "logins",
          "added": 0,
          "updated": 39,
          "total": 44
        },
        {
          "table": "docs",
          "added": 0,
          "updated": 3,
          "total": 3
        },
        {
          "table": "sheets",
          "added": 0,
          "updated": 0,
          "total": 0
        },
        {
          "table": "ledgers",
          "added": 0,
          "updated": 14,
          "total": 14
        },
        {
          "table": "vouchers",
          "added": 0,
          "updated": 0,
          "total": 0
        }
      ]
    },
    {
      "at": "2026-10-25T05:10:05.980Z",
      "by": "Sangram",
      "action": "email",
      "recipient": "budamale7@gmail.com",
      "size": 5648
    },
    {
      "at": "2026-10-25T05:07:05.240Z",
      "by": "admin",
      "action": "email",
      "recipient": "budamale7@gmail.com",
      "size": 5632
    },
    {
      "at": "2026-10-25T05:05:30.733Z",
      "by": "admin",
      "action": "import",
      "stats": [
        {
          "table": "users",
          "added": 0,
          "updated": 2,
          "total": 2
        },
        {
          "table": "clients",
          "added": 0,
          "updated": 1,
          "total": 1
        },
        {
          "table": "products",
          "added": 0,
          "updated": 1,
          "total": 1
        },
        {
          "table": "invoices",
          "added": 0,
          "updated": 5,
          "total": 5
        },
        {
          "table": "purchases",
          "added": 0,
          "updated": 0,
          "total": 0
        },
        {
          "table": "workupdates",
          "added": 0,
          "updated": 3,
          "total": 3
        },
        {
          "table": "logins",
          "added": 0,
          "updated": 37,
          "total": 37
        },
        {
          "table": "docs",
          "added": 0,
          "updated": 3,
          "total": 3
        },
        {
          "table": "sheets",
          "added": 0,
          "updated": 0,
          "total": 0
        },
        {
          "table": "ledgers",
          "added": 0,
          "updated": 14,
          "total": 14
        },
        {
          "table": "vouchers",
          "added": 0,
          "updated": 0,
          "total": 0
        }
      ]
    }
  ],
  "emailedSize": 6119
}'::jsonb, NOW())
ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW();

-- 9. ACTIVITY LOGS
INSERT INTO public.activity_logs (id, date, user_id, username, login_time, last_seen_at, active_minutes, idle_minutes, status, actions, offline_alert_sent, offline_alert_sent_at, updated_at)
VALUES ('2026-11-01_8b61855ec159', '2026-11-01', '8b61855ec159', 'admin', '2026-11-01T12:33:54.218Z', '2026-11-01T18:29:56.125Z', 85.4044, 86.50004999999997, 'active', '[]'::jsonb, FALSE, NULL, NOW())
ON CONFLICT (id) DO UPDATE SET active_minutes=EXCLUDED.active_minutes, idle_minutes=EXCLUDED.idle_minutes, actions=EXCLUDED.actions, last_seen_at=EXCLUDED.last_seen_at;
INSERT INTO public.activity_logs (id, date, user_id, username, login_time, last_seen_at, active_minutes, idle_minutes, status, actions, offline_alert_sent, offline_alert_sent_at, updated_at)
VALUES ('2026-11-01_ff9deb24622c', '2026-11-01', 'ff9deb24622c', 'Sangram', '2026-11-01T13:20:45.995Z', '2026-11-01T13:21:59.656Z', 1.1533, 0, 'active', '[]'::jsonb, FALSE, NULL, NOW())
ON CONFLICT (id) DO UPDATE SET active_minutes=EXCLUDED.active_minutes, idle_minutes=EXCLUDED.idle_minutes, actions=EXCLUDED.actions, last_seen_at=EXCLUDED.last_seen_at;
INSERT INTO public.activity_logs (id, date, user_id, username, login_time, last_seen_at, active_minutes, idle_minutes, status, actions, offline_alert_sent, offline_alert_sent_at, updated_at)
VALUES ('2026-11-02_8b61855ec159', '2026-11-02', '8b61855ec159', 'admin', '2026-11-01T18:30:26.196Z', '2026-11-01T19:23:55.678Z', 36.56151666666666, 15.101033333333334, 'active', '[]'::jsonb, FALSE, NULL, NOW())
ON CONFLICT (id) DO UPDATE SET active_minutes=EXCLUDED.active_minutes, idle_minutes=EXCLUDED.idle_minutes, actions=EXCLUDED.actions, last_seen_at=EXCLUDED.last_seen_at;
INSERT INTO public.activity_logs (id, date, user_id, username, login_time, last_seen_at, active_minutes, idle_minutes, status, actions, offline_alert_sent, offline_alert_sent_at, updated_at)
VALUES ('2026-11-03_8b61855ec159', '2026-11-03', '8b61855ec159', 'admin', '2026-11-03T03:58:19.377Z', '2026-11-03T06:04:45.765Z', 76.5529833333333, 26.821183333333334, 'active', '[]'::jsonb, FALSE, NULL, NOW())
ON CONFLICT (id) DO UPDATE SET active_minutes=EXCLUDED.active_minutes, idle_minutes=EXCLUDED.idle_minutes, actions=EXCLUDED.actions, last_seen_at=EXCLUDED.last_seen_at;
INSERT INTO public.activity_logs (id, date, user_id, username, login_time, last_seen_at, active_minutes, idle_minutes, status, actions, offline_alert_sent, offline_alert_sent_at, updated_at)
VALUES ('2026-11-03_ff9deb24622c_no_login_alert', '2026-11-03', 'ff9deb24622c_no_login_alert', '', NULL, NULL, 0, 0, NULL, '[]'::jsonb, FALSE, NULL, NOW())
ON CONFLICT (id) DO UPDATE SET active_minutes=EXCLUDED.active_minutes, idle_minutes=EXCLUDED.idle_minutes, actions=EXCLUDED.actions, last_seen_at=EXCLUDED.last_seen_at;
-- Total activity logs inserted: 5
