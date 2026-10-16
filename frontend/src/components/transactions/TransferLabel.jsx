import { Trans } from "react-i18next";

// "From A to B" for either row of a transfer, with each account name in the
// account's color. `accountsById` maps account ids to { name, color }.
export default function TransferLabel({ transaction, accountsById }) {
  const isOut = transaction.type === "transfer_out";
  const from = accountsById[isOut ? transaction.accountId : transaction.counterpartAccountId];
  const to = accountsById[isOut ? transaction.counterpartAccountId : transaction.accountId];
  const accountSpan = (account) => <span style={{ color: account?.color || "#6B7280" }} />;

  return (
    <Trans
      i18nKey="transfers.fromTo"
      values={{ from: from?.name ?? "—", to: to?.name ?? "—" }}
      components={{ from: accountSpan(from), to: accountSpan(to) }}
    />
  );
}
