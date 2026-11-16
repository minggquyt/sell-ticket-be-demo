// Self-check: node test/bank-dto.check.js (không cần DB / .env)
const assert = require('assert');
const { UpdateBankRequestDTO, toBankAccountName } = require('../src/dto/auth.dto');

assert.strictEqual(toBankAccountName('  nguyễn   văn  đức 123 '), 'NGUYEN VAN DUC');
assert.strictEqual(toBankAccountName('Trần Thị Ánh-Tuyết'), 'TRAN THI ANHTUYET');

const ok = new UpdateBankRequestDTO({
  bankBin: '970436', bankShortName: 'Vietcombank', bankName: 'Ngân hàng TMCP Ngoại Thương',
  bankLogo: 'https://api.vietqr.io/img/VCB.png', bankAccountNo: ' 0123 456 789 ', bankAccountName: 'lê văn a',
});
assert.ok(ok.validate().isValid);
assert.strictEqual(ok.toServiceInput().bankAccountNo, '0123456789');
assert.strictEqual(ok.toServiceInput().bankAccountName, 'LE VAN A');

assert.ok(!new UpdateBankRequestDTO({ ...ok, bankBin: 'abc' }).validate().isValid, 'BIN tự gõ');
assert.ok(!new UpdateBankRequestDTO({ ...ok, bankAccountNo: '12345' }).validate().isValid, 'STK < 6');
assert.ok(!new UpdateBankRequestDTO({ ...ok, bankAccountNo: '1234-5678' }).validate().isValid, 'STK ký tự lạ');
assert.ok(!new UpdateBankRequestDTO({ ...ok, bankLogo: 'javascript:alert(1)' }).validate().isValid, 'logo không https');
console.log('bank-dto.check OK');
