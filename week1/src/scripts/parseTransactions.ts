import { runTransactionParserDemo } from '../parsers/transactionParser';

runTransactionParserDemo().catch((error) => {
  console.error(error);
  process.exit(1);
});