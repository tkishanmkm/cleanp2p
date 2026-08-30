
import Link from "next/link";
import { Gavel, MessageSquare, ShieldCheck } from "lucide-react";

export default function DisputeResolutionPage() {
  return (
    <div className="prose dark:prose-invert max-w-4xl mx-auto">
      <h1>Dispute Resolution Process</h1>
      <p className="lead">
        At Paxones, we strive to ensure every trade is smooth and successful. However, disagreements can sometimes occur. Our dispute resolution process is designed to provide a fair and impartial outcome when they do.
      </p>

      <h2>
        <ShieldCheck className="inline-block -mt-1 mr-2" /> What is a Dispute?
      </h2>
      <p>
        A dispute can be opened by either the buyer or the seller if they believe the other party has not fulfilled their side of the trade agreement. Common reasons for disputes include:
      </p>
      <ul>
        <li><strong>For Buyers:</strong> The buyer has sent payment, but the seller has not released the cryptocurrency.</li>
        <li><strong>For Sellers:</strong> The buyer has marked the trade as "Paid" but the seller has not received the payment, or the payment received is incorrect.</li>
        <li><strong>General:</strong> Unresponsive trade partner, violation of trade terms, or suspected scam activity.</li>
      </ul>
      <p>
        <strong>Note:</strong> A dispute can typically only be opened after a trade has been marked as "Paid."
      </p>

      <h2>
        <Gavel className="inline-block -mt-1 mr-2" /> How the Process Works
      </h2>
      <ol>
        <li>
          <strong>Opening a Dispute:</strong> Within the trade chat, click the "Open Dispute" button. You will be asked to provide a reason for the dispute. This action freezes the trade and notifies our moderation team.
        </li>
        <li>
          <strong>Moderator Joins:</strong> A Paxones moderator will join the trade chat. They will have access to all trade details, chat history, and timestamps.
        </li>
        <li>
          <strong>Evidence Submission:</strong> The moderator will ask both parties to provide evidence. For buyers, this is typically a clear proof of payment (e.g., a bank transaction receipt with a transaction ID). For sellers, this may be a statement showing the payment has not been received.
        </li>
        <li>
          <strong>Investigation:</strong> The moderator will carefully review all evidence and communication. They may ask clarifying questions to both parties.
        </li>
        <li>
          <strong>Resolution:</strong> Based on the evidence, the moderator will make a final decision. They will award the escrowed cryptocurrency to the rightful party. If the buyer wins, the crypto is released to them. If the seller wins, the crypto is returned to their wallet from escrow.
        </li>
      </ol>
      <p>The moderator's decision is final and binding.</p>

      <h2>
        <MessageSquare className="inline-block -mt-1 mr-2" /> Tips for a Smooth Resolution
      </h2>
      <ul>
        <li><strong>Be Honest and Clear:</strong> Provide truthful information and clear, unedited evidence.</li>
        <li><strong>Stay Professional:</strong> Communicate respectfully with the moderator and the other party. Abusive language will not be tolerated.</li>
        <li><strong>Be Patient:</strong> Our moderators handle cases as quickly as possible, but a thorough investigation takes time.</li>
        <li><strong>Keep Everything on Paxones:</strong> Our moderators can only consider evidence from within the Paxones platform (trade chat, payment details). Any communication outside the platform cannot be used.</li>
      </ul>
      
      <div className="not-prose mt-8">
        <p>If you have questions about the dispute process or need to report an issue outside of a trade, please <Link href="/contact" className="font-semibold underline">contact our support team</Link>.</p>
      </div>
    </div>
  );
}
