<script lang="ts">
  import { chains } from "../domain/chain";
  import { transactions, showTransactionDetails } from "../store/transactions";
  import Transaction from "./Transaction.svelte";
  import TransactionDetail from './TransactionDetail.svelte';
</script>

<div class="my-4 px-4">
  {#if $transactions.length}
    <table class="table-auto">
      <thead>
        <tr>
          <th>From</th>
          <th>To</th>
          <th>Amount</th>
          <th>Status</th>
          <th>Details</th>
        </tr>
      </thead>
      <tbody>
        {#each $transactions as transaction}
          <Transaction
            toChain={chains[transaction.toChainId]}
            fromChain={chains[transaction.fromChainId]}
            {transaction}
          />
        {/each}
      </tbody>
    </table>
  {:else}
    No transactions
  {/if}

  {#if $showTransactionDetails}
    <TransactionDetail transaction={$showTransactionDetails} />
  {/if}
</div>
