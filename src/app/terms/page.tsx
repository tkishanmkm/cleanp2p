import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";

export const metadata = {
  title: "Terms of Service | Paxones™",
  description: "Official Paxones™ Peer-to-Peer Digital Asset Marketplace Terms of Service.",
};

export default function TermsPage() {
  return (
    <div className="flex flex-col min-h-screen bg-slate-50 dark:bg-[#07090e] text-slate-900 dark:text-slate-100 transition-colors">
      <Header />
      <main className="flex-grow container mx-auto px-4 py-12 md:py-16 max-w-4xl">
        <div className="bg-white dark:bg-[#0f1423] border border-slate-200 dark:border-[#1e2640] rounded-2xl p-6 sm:p-10 md:p-12 shadow-sm">
          
          {/* Header Banner */}
          <div className="border-b border-slate-200 dark:border-[#1e2640] pb-6 mb-8">
            <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-slate-900 dark:text-white mb-3">
              PAXONES™ TERMS OF SERVICE
            </h1>
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
              <strong>Effective Date:</strong> January 1, 2026 &nbsp;|&nbsp; <strong>Last Updated:</strong> September 9, 2026
            </p>
          </div>

          {/* High-Risk Warning Box */}
          <div className="bg-amber-500/10 border border-amber-500/20 text-amber-900 dark:text-amber-200 rounded-xl p-5 mb-10 text-sm leading-relaxed">
            <h2 className="text-base font-bold mb-2 flex items-center gap-2 text-amber-800 dark:text-amber-300">
              ⚠️ IMPORTANT NOTICE & RISK WARNING
            </h2>
            <p className="mb-3">
              PLEASE READ THESE TERMS OF SERVICE CAREFULLY BEFORE CREATING AN ACCOUNT OR USING PAXONES™.
            </p>
            <p className="mb-3">
              These Terms of Service (&ldquo;Terms,&rdquo; &ldquo;Agreement,&rdquo; or &ldquo;Terms of Service&rdquo;) govern your access to and use of the Paxones platform, website, mobile applications, digital asset wallet services, peer-to-peer marketplace, escrow services, internal transfers, and related services.
            </p>
            <p className="mb-3">
              By creating an account, accessing the platform, browsing the marketplace, posting an offer, accepting an offer, initiating a trade, depositing, withdrawing, transferring, or otherwise using any Paxones service, you acknowledge that you have read, understood, and agreed to be bound by these Terms.
            </p>
            <p className="mb-3">
              If you do not agree with these Terms, you must not create an account or use Paxones.
            </p>
            <p className="font-bold uppercase tracking-wide">
              DIGITAL ASSETS ARE HIGH-RISK PRODUCTS. THEIR VALUE MAY CHANGE RAPIDLY AND YOU MAY LOSE SOME OR ALL OF THE VALUE OF DIGITAL ASSETS YOU BUY, SELL, HOLD, OR TRANSFER. YOU ARE SOLELY RESPONSIBLE FOR EVALUATING WHETHER USE OF PAXONES IS APPROPRIATE FOR YOU.
            </p>
          </div>

          {/* Full 67 Sections */}
          <div className="space-y-8 text-sm text-slate-700 dark:text-slate-300 leading-relaxed divide-y divide-slate-100 dark:divide-[#1a2238]">
            
            <section className="pt-6 first:pt-0">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">1. ABOUT PAXONES AND ITS SERVICES</h2>
              <p className="mb-2">Paxones™ (&ldquo;Paxones,&rdquo; &ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;) operates a peer-to-peer digital asset marketplace designed to allow users to buy and sell supported digital assets directly with one another.</p>
              <p className="mb-2">Paxones may provide the following services:</p>
              <ol className="list-decimal list-inside space-y-1 pl-2 mb-3">
                <li>Peer-to-peer digital asset trading;</li>
                <li>Marketplace advertisements and offers;</li>
                <li>Digital asset wallets;</li>
                <li>Escrow locking and release services;</li>
                <li>Internal user-to-user transfers;</li>
                <li>External digital asset deposits and withdrawals;</li>
                <li>Transaction chat and communication tools;</li>
                <li>Trade dispute and review services;</li>
                <li>Account security and authentication features;</li>
                <li>Transaction history and account records; and</li>
                <li>Other features that Paxones may introduce from time to time.</li>
              </ol>
              <p className="mb-2">Paxones provides the technology and infrastructure through which users can interact with one another.</p>
              <p className="mb-2">Unless expressly stated otherwise, Paxones is not the buyer or seller in a peer-to-peer transaction. A transaction is entered into between the users participating in that transaction.</p>
              <p className="mb-2">Paxones may temporarily hold or lock digital assets as part of its escrow and transaction procedures. Such locking is intended to facilitate the completion of a P2P transaction and does not change the user&apos;s responsibility for complying with these Terms.</p>
              <p>Paxones does not guarantee that any particular offer, buyer, seller, payment method, price, transaction, or trading opportunity will always be available.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">2. ACCEPTANCE OF THESE TERMS</h2>
              <p className="mb-2">By using Paxones, you confirm that:</p>
              <ol className="list-decimal list-inside space-y-1 pl-2 mb-3">
                <li>You have read and understood these Terms;</li>
                <li>You agree to comply with these Terms;</li>
                <li>You will provide truthful and accurate information;</li>
                <li>You will use Paxones only for legitimate purposes;</li>
                <li>You will not attempt to circumvent Paxones controls;</li>
                <li>You will maintain the security of your account;</li>
                <li>You accept the risks associated with digital assets and peer-to-peer transactions; and</li>
                <li>You accept that Paxones may take actions necessary to protect the platform, its users, and its operations.</li>
              </ol>
              <p>If you do not agree to these requirements, you must stop using Paxones.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">3. ELIGIBILITY</h2>
              <p className="mb-2">You must be at least 18 years old and have sufficient legal capacity to create and operate a Paxones account.</p>
              <p className="mb-2">By registering, you represent and confirm that:</p>
              <ol className="list-decimal list-inside space-y-1 pl-2 mb-3">
                <li>You are at least 18 years old;</li>
                <li>The information you provide is accurate;</li>
                <li>You are creating the account for yourself or for an entity you are authorized to represent;</li>
                <li>You are not attempting to create an account using another person&apos;s identity;</li>
                <li>You have not previously been permanently banned from Paxones unless Paxones has expressly authorized you to return;</li>
                <li>You will not allow another person to operate your account; and</li>
                <li>You will comply with all applicable requirements relevant to your use of the platform.</li>
              </ol>
              <p>Paxones may refuse registration or restrict access where necessary for security, compliance, fraud prevention, risk management, or protection of the platform.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">4. ACCOUNT REGISTRATION</h2>
              <p className="mb-2">To access certain Paxones services, you must create an account.</p>
              <p className="mb-2">You agree to provide accurate, complete, and current information during registration and whenever Paxones requests updated information.</p>
              <p className="mb-2">You must not:</p>
              <ul className="list-disc list-inside space-y-1 pl-2 mb-3">
                <li>Create an account using false information;</li>
                <li>Use another person&apos;s identity;</li>
                <li>Impersonate another person;</li>
                <li>Provide misleading information;</li>
                <li>Manipulate your country or location information;</li>
                <li>Create an account for another person without authorization;</li>
                <li>Create multiple personal accounts;</li>
                <li>Sell, rent, lease, lend, or transfer your account;</li>
                <li>Allow another person to access or operate your account; or</li>
                <li>Use an account that belongs to another person.</li>
              </ul>
              <p>Paxones may require additional information or verification before allowing access to certain services, limits, transactions, withdrawals, or features.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">5. ONE ACCOUNT PER PERSON</h2>
              <p className="mb-2">Each individual may maintain only one active personal Paxones account unless Paxones expressly permits otherwise.</p>
              <p className="mb-2">Creating multiple accounts to circumvent:</p>
              <ul className="list-disc list-inside space-y-1 pl-2 mb-3">
                <li>Trading limits;</li>
                <li>Withdrawal limits;</li>
                <li>Security controls;</li>
                <li>Restrictions;</li>
                <li>Suspensions;</li>
                <li>Fees;</li>
                <li>Reputation systems;</li>
                <li>Verification requirements; or</li>
                <li>Other Paxones controls</li>
              </ul>
              <p className="mb-2">is strictly prohibited.</p>
              <p>Paxones may link accounts that appear to be controlled by the same person or group and may restrict, suspend, or terminate such accounts.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">6. IDENTITY VERIFICATION</h2>
              <p className="mb-2">Paxones may require users to complete identity verification before or during the use of certain services.</p>
              <p className="mb-2">Verification may require information such as:</p>
              <ul className="list-disc list-inside space-y-1 pl-2 mb-3">
                <li>Full legal name;</li>
                <li>Date of birth;</li>
                <li>Country of residence or origin;</li>
                <li>Address;</li>
                <li>Identification information;</li>
                <li>Identification documents;</li>
                <li>Photographs;</li>
                <li>Biometric information;</li>
                <li>Contact information; or</li>
                <li>Other information reasonably necessary for account verification and security.</li>
              </ul>
              <p className="mb-2">You agree that all information and documents submitted for verification must be authentic, accurate, current, and belong to you.</p>
              <p className="mb-2">Submitting altered, fabricated, stolen, borrowed, or misleading identity information is strictly prohibited.</p>
              <p className="mb-2">Once certain identity information has been verified, Paxones may lock or restrict modification of that information to prevent identity abuse, account sharing, impersonation, and fraud.</p>
              <p className="mb-2">Paxones may request additional verification at any time.</p>
              <p>Failure to complete required verification may result in restricted trading, withdrawals, transfers, or other account functions.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">7. ACCOUNT SECURITY</h2>
              <p className="mb-2">You are responsible for protecting your Paxones account. You must keep secure:</p>
              <ul className="list-disc list-inside space-y-1 pl-2 mb-3">
                <li>Passwords;</li>
                <li>Authentication codes;</li>
                <li>Two-factor authentication credentials;</li>
                <li>Backup codes;</li>
                <li>Recovery information;</li>
                <li>API credentials, where applicable;</li>
                <li>Devices used to access your account; and</li>
                <li>Any other account credentials.</li>
              </ul>
              <p className="mb-2">You must immediately notify Paxones if you believe:</p>
              <ol className="list-decimal list-inside space-y-1 pl-2 mb-3">
                <li>Your password has been compromised;</li>
                <li>Someone has accessed your account without permission;</li>
                <li>Your authentication credentials have been exposed;</li>
                <li>Your device has been compromised; or</li>
                <li>Unauthorized activity has occurred.</li>
              </ol>
              <p className="mb-2">You must never share your password, authentication codes, backup codes, or recovery credentials with another person.</p>
              <p className="mb-2">Paxones will not ask you to disclose your password or authentication codes through unofficial communication channels.</p>
              <p className="mb-2">You should never provide remote access to your device while logged into your Paxones account.</p>
              <p>Paxones is not responsible for losses caused by your failure to adequately secure your account, except where such responsibility cannot be excluded under these Terms.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">8. DIGITAL ASSET WALLET</h2>
              <p className="mb-2">Paxones may provide digital asset wallet functionality that allows you to deposit, hold, transfer, and withdraw supported digital assets.</p>
              <p className="mb-2">Your wallet balance displayed on Paxones represents the balance associated with your account within the Paxones system.</p>
              <p className="mb-2">Supported assets, networks, deposit methods, withdrawal methods, limits, confirmations, and availability may change at any time.</p>
              <p className="mb-2">You are solely responsible for providing accurate transaction information.</p>
              <p className="mb-2">If you provide an incorrect wallet address, network, asset, amount, memo, tag, or other transaction information, Paxones may be unable to recover the assets.</p>
              <p>Paxones is not responsible for losses caused by incorrect transaction information supplied by you.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">9. DIGITAL ASSET DEPOSITS</h2>
              <p className="mb-2">When depositing digital assets to Paxones, you must:</p>
              <ol className="list-decimal list-inside space-y-1 pl-2 mb-3">
                <li>Select the correct asset;</li>
                <li>Select the correct network;</li>
                <li>Use the correct deposit address;</li>
                <li>Include any required memo or destination information; and</li>
                <li>Send only supported assets and networks.</li>
              </ol>
              <p className="mb-2">Sending an unsupported asset or sending an asset through an unsupported network may result in permanent loss.</p>
              <p className="mb-2">Blockchain transactions may require network confirmations before becoming available in your Paxones balance.</p>
              <p>Paxones does not guarantee a specific confirmation time.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">10. DIGITAL ASSET WITHDRAWALS</h2>
              <p className="mb-2">Withdrawals are subject to applicable Paxones security controls. Paxones may require:</p>
              <ul className="list-disc list-inside space-y-1 pl-2 mb-3">
                <li>Two-factor authentication;</li>
                <li>Additional verification;</li>
                <li>Withdrawal confirmation;</li>
                <li>Security review;</li>
                <li>Temporary withdrawal restrictions; or</li>
                <li>Other protective measures.</li>
              </ul>
              <p className="mb-2">Once a blockchain transaction has been submitted and confirmed for processing, it may not be possible to cancel or reverse it.</p>
              <p>You are responsible for checking the asset, network, wallet address, amount, memo or tag, and other transaction details before confirming a withdrawal.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">11. PEER-TO-PEER MARKETPLACE</h2>
              <p className="mb-2">Paxones provides a marketplace where users may create offers to buy or sell supported digital assets.</p>
              <p className="mb-2">An offer may contain:</p>
              <ul className="list-disc list-inside space-y-1 pl-2 mb-3">
                <li>Digital asset;</li>
                <li>Price;</li>
                <li>Amount;</li>
                <li>Minimum and maximum transaction limits;</li>
                <li>Payment method;</li>
                <li>Payment instructions;</li>
                <li>Payment window;</li>
                <li>Additional trade requirements; and</li>
                <li>Other conditions permitted by Paxones.</li>
              </ul>
              <p className="mb-2">The creator of an offer is responsible for ensuring that the offer information is accurate and complies with these Terms.</p>
              <p className="mb-2">Users must carefully review an offer before accepting it.</p>
              <p>Once a trade is initiated, the parties are expected to follow the terms displayed in the trade room.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">12. P2P ESCROW</h2>
              <p className="mb-2">When a seller initiates a qualifying P2P transaction, the relevant digital assets may be automatically locked in Paxones escrow.</p>
              <p className="mb-2">Locked assets cannot normally be withdrawn or used for another transaction while the trade remains active.</p>
              <p className="mb-2">The purpose of escrow is to help ensure that the digital assets remain available while the buyer completes the required payment.</p>
              <p>Escrow does not guarantee that a fiat payment will be completed, received, cleared, or irreversible.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">13. BUYER RESPONSIBILITIES</h2>
              <p className="mb-2">A buyer must:</p>
              <ol className="list-decimal list-inside space-y-1 pl-2 mb-3">
                <li>Read the seller&apos;s offer carefully;</li>
                <li>Follow the seller&apos;s stated payment instructions;</li>
                <li>Pay the exact required amount;</li>
                <li>Use an approved payment method;</li>
                <li>Use a payment account belonging to the buyer;</li>
                <li>Complete payment within the specified payment period;</li>
                <li>Mark the trade as paid only after actually making payment;</li>
                <li>Upload genuine payment evidence when requested;</li>
                <li>Remain available in the trade room; and</li>
                <li>Cooperate with any dispute review.</li>
              </ol>
              <p>A buyer must not falsely mark a trade as paid, submit fabricated evidence, intentionally delay a trade, or pressure a seller into releasing assets before payment is verified.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">14. SELLER RESPONSIBILITIES</h2>
              <p className="mb-2">A seller must:</p>
              <ol className="list-decimal list-inside space-y-1 pl-2 mb-3">
                <li>Maintain sufficient digital assets to support active offers;</li>
                <li>Provide accurate offer instructions;</li>
                <li>Monitor active trades;</li>
                <li>Verify incoming payments carefully;</li>
                <li>Confirm that the payment has actually been received;</li>
                <li>Confirm that the payment satisfies the offer requirements;</li>
                <li>Release escrow promptly after valid payment is confirmed;</li>
                <li>Respond to trade-related messages;</li>
                <li>Cooperate with dispute investigations; and</li>
                <li>Keep inactive offers disabled.</li>
              </ol>
              <p>A seller must not falsely claim that payment was not received when valid payment has been received, or refuse to release escrow after verified receipt.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">15. PAYMENT VERIFICATION</h2>
              <p className="mb-2">Unless an offer expressly specifies custom payment settlement instructions, payments should be confirmed and received as agreed in the trade terms.</p>
              <p className="mb-2">You must ensure that all funds transferred originate from authorized accounts, that transaction details match the agreed specifications, and that no stolen payment instruments or fraudulent chargebacks are utilized.</p>
              <p>A transaction may be subject to dispute review or cancelled if payment settlement cannot be verified by the recipient.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">16. ON-PLATFORM COMMUNICATION</h2>
              <p className="mb-2">All trade-related communication must remain inside the official Paxones trade room unless Paxones expressly permits otherwise.</p>
              <p className="mb-2">Users must not attempt to move a trade outside Paxones through external messaging apps, social media, email, or private channels.</p>
              <p>Paxones may review trade-room communications when necessary for security, fraud prevention, support, dispute resolution, or enforcement.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">17. OFF-PLATFORM TRADING</h2>
              <p className="mb-2">Users must not use Paxones to arrange transactions that are ultimately completed outside Paxones.</p>
              <p className="mb-2">You must not exchange external contact details for off-platform trades, direct users to other platforms, offer discounts for off-platform completion, or encourage trade cancellations.</p>
              <p>Paxones may restrict or terminate accounts involved in off-platform trading.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">18. PAYMENT VERIFICATION</h2>
              <p className="mb-2">Users are responsible for verifying payments. A payment screenshot, receipt, notification, or other evidence does not automatically establish that funds have been received.</p>
              <p className="mb-2">Sellers should verify their actual bank or payment account before releasing escrow.</p>
              <p>Users must not provide fabricated, altered, edited, misleading, or incomplete payment evidence.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">19. TRADE TIMERS</h2>
              <p className="mb-2">Paxones may impose time limits for buyers to complete payment and for sellers to respond or release assets.</p>
              <p className="mb-2">Users must not intentionally manipulate, abuse, or stall trade timers (such as opening trades without payment intent, repeatedly marking paid without paying, or delaying release).</p>
              <p>Such activity is considered market abuse and subject to account restriction.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">20. TRADE CANCELLATION</h2>
              <p className="mb-2">A trade may be cancelled when payment is not made in time, instructions are not followed, parties mutually agree, or platform risk reviews dictate cancellation.</p>
              <p>Repeated unnecessary cancellations may negatively affect account reputation or trading privileges.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">21. DISPUTES</h2>
              <p className="mb-2">Either party may initiate a dispute when a trade cannot be resolved between buyer and seller.</p>
              <p className="mb-2">When a dispute is opened, Paxones may restrict escrow movement, review trade messages and logs, request payment proof/documents, and make an authoritative determination based on available evidence.</p>
              <p>Users must cooperate fully with dispute investigations.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">22. DISPUTE EVIDENCE</h2>
              <p className="mb-2">Evidence submitted must be genuine, unaltered, and complete (including bank statements, video recordings, blockchain txids, and unedited receipts).</p>
              <p>A user who refuses or fails to provide requested evidence may have the dispute resolved against them.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">23. DISPUTE DECISIONS</h2>
              <p className="mb-2">Paxones may resolve a dispute in favor of the buyer where valid payment was received by the seller, or in favor of the seller where valid payment was not received, was reversed, or violated offer conditions.</p>
              <p>Where evidence is ambiguous, Paxones may determine an equitable resolution based on the full transaction history.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">24. DISPUTE APPEALS</h2>
              <p className="mb-2">Users may request review of a dispute decision through Paxones Support by presenting new, substantial evidence.</p>
              <p>Final internal dispute decisions may be treated as conclusive for platform purposes.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">25. CHARGEBACKS AND PAYMENT REVERSALS</h2>
              <p className="mb-2">Users must not intentionally reverse, dispute, charge back, or cancel payment after receiving digital assets.</p>
              <p>In the event of a chargeback, Paxones may freeze balances, restrict withdrawals, recover funds, or terminate offending accounts.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">26. INTERNAL TRANSFERS</h2>
              <p className="mb-2">Paxones allows instant internal transfers between Paxones user balances. Users are responsible for confirming recipient usernames and amounts.</p>
              <p>Internal transfers are irreversible once executed on the ledger.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">27. FEES</h2>
              <p className="mb-2">Unless otherwise stated, the standard Paxones P2P escrow fee is <strong>1.5% of the gross trade value upon successful settlement</strong>.</p>
              <p className="mb-2">The standard internal user-to-user transfer fee is <strong>1.5%</strong>.</p>
              <p>Applicable network withdrawal fees and platform charges are displayed transparently prior to confirmation.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">28. NO REFUNDS OF COMPLETED SERVICES</h2>
              <p>Once a blockchain transaction has been broadcast or a trade settled, associated platform fees are non-refundable.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">29. MARKETPLACE OFFERS</h2>
              <p className="mb-2">Offer creators must ensure prices, limits, payment terms, and trade requirements are accurate and lawful.</p>
              <p>Paxones reserves the right to remove or modify offers violating platform standards.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">30. USER REPUTATION</h2>
              <p className="mb-2">Paxones maintains feedback scores, completion metrics, and trade statistics.</p>
              <p>Manipulating reputation (via fake reviews, self-trading, extortion, or multi-accounting) is strictly prohibited.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">31. PROHIBITED ACTIVITIES</h2>
              <p className="mb-2">You must not use Paxones for fraud, theft, money laundering, darknet transactions, malware dissemination, scrapers, harassment, extortion, impersonation, or unauthorized access attempts.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">32. MARKET MANIPULATION</h2>
              <p>Wash trading, deceptive order book manipulation, artificial volume inflation, and coordinated disruption of counterparties are strictly prohibited.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">33. FRAUD AND DECEPTIVE ACTIVITY</h2>
              <p>Paxones maintains a zero-tolerance policy against deceptive conduct, fake receipts, stolen accounts, phishing, and social engineering.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">34. ACCOUNT SUSPENSION AND RESTRICTION</h2>
              <p>Paxones may restrict trading, withdrawals, or account access during active security reviews, risk alerts, or compliance inquiries.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">35. ACCOUNT TERMINATION</h2>
              <p>Paxones may permanently terminate accounts involved in material breaches of these Terms or fraudulent activity.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">36. RESTRICTED ACCESS AND BALANCES</h2>
              <p>Balances subject to unresolved disputes or security investigations may remain frozen until the investigation completes.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">37. BLOCKCHAIN RISKS</h2>
              <p>Paxones does not control decentralized blockchain networks and is not liable for forks, reorgs, protocol disruptions, or high on-chain network congestion fees.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">38. PRICING AND TECHNICAL ERRORS</h2>
              <p>In the event of typographical or computational pricing errors on the platform, Paxones may take corrective actions to restore ledger integrity.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">39. SERVICE AVAILABILITY</h2>
              <p>Platform services are provided subject to routine maintenance, upgrades, and operational availability.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">40. LIMITS</h2>
              <p>Paxones may establish tier-based limits for deposits, withdrawals, internal transfers, and active trade volumes.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">41. TAX RESPONSIBILITY</h2>
              <p>Users are solely responsible for determining, calculating, and remitting any taxes arising from their cryptocurrency transactions.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">42. NO INVESTMENT OR FINANCIAL ADVICE</h2>
              <p>Paxones does not provide financial, investment, legal, or tax advice. All trading decisions are made independently by the user.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">43. DIGITAL ASSET RISK</h2>
              <p>You acknowledge price volatility, liquidity hazards, private key losses, and the irreversible nature of cryptocurrency transactions.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">44. USER CONTENT</h2>
              <p>You retain ownership of content submitted to the platform but grant Paxones the license to host and process such data for service operations.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">45. MONITORING AND SECURITY</h2>
              <p>Paxones utilizes automated systems and risk analysts to monitor platform activities, prevent fraudulent behavior, and protect user assets.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">46. PRIVACY</h2>
              <p>Personal information is processed in strict compliance with the Paxones Privacy Policy for account verification, transaction processing, and security.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">47. COMMUNICATIONS</h2>
              <p>Official notices are communicated via platform in-app alerts, trade-room logs, and registered account email addresses.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">48. INTELLECTUAL PROPERTY</h2>
              <p>Paxones trademarks, interface designs, logos, software, and proprietary code are protected intellectual property of Paxones.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">49. THIRD-PARTY SERVICES AND CONTENT</h2>
              <p>Paxones is not responsible for the independent performance or uptime of external payment processors, banking rails, or third-party identity providers.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">50. USER DISPUTES</h2>
              <p>Disputes between users must be addressed through the Paxones trade-room dispute workflow.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">51. RELEASE</h2>
              <p>To the maximum extent permitted by law, users release Paxones and its affiliates from claims arising directly between users.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">52. INDEMNIFICATION</h2>
              <p>You agree to indemnify and hold harmless Paxones from third-party claims, liabilities, or losses resulting from your breach of these Terms.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">53. LIMITATION OF LIABILITY</h2>
              <p>Paxones liability for claims arising out of service use shall not exceed total platform fees paid by you in the preceding 12 months.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">54. NO WARRANTY</h2>
              <p>Paxones services are provided &ldquo;AS IS&rdquo; and &ldquo;AS AVAILABLE&rdquo; without warranties of uninterrupted uptime or error-free operation.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">55. FORCE MAJEURE</h2>
              <p>Paxones is not liable for performance failures resulting from major network disruptions, acts of civil authority, power outages, or natural disasters.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">56. CHANGES TO THE SERVICES</h2>
              <p>Paxones reserves the right to modify features, trading pairs, network parameters, and fee schedules.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">57. CHANGES TO THESE TERMS</h2>
              <p>Updated terms become effective immediately upon posting to the platform. Continued use indicates agreement to revised Terms.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">58. NO WAIVER</h2>
              <p>Failure by Paxones to strictly enforce any provision does not constitute a waiver of future enforcement rights.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">59. SEVERABILITY</h2>
              <p>If any clause is deemed invalid or unenforceable, the remaining clauses remain fully enforceable.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">60. ENTIRE AGREEMENT</h2>
              <p>These Terms comprise the entire understanding between you and Paxones regarding marketplace usage.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">61. ASSIGNMENT</h2>
              <p>Users may not assign accounts without prior written consent from Paxones.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">62. SURVIVAL</h2>
              <p>Provisions concerning dispute resolution, liability, indemnification, and fees survive account closure.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">63. RECORDS</h2>
              <p>Paxones maintains secure audit logs of trading and blockchain operations for compliance and security.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">64. SUPPORT</h2>
              <p>Official user support is available through verified in-app tickets and support channels.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">65. USER RESPONSIBILITY</h2>
              <p>You remain solely responsible for reviewing counterpart terms, wallet addresses, credentials, and trade conditions.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">66. ACKNOWLEDGEMENT OF P2P RISKS</h2>
              <p>You acknowledge that P2P trading involves direct buyer-seller interactions and accept counterparty and payment method risks.</p>
            </section>

            <section className="pt-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">67. FINAL ACKNOWLEDGEMENT</h2>
              <p className="font-semibold text-slate-900 dark:text-white mb-2">
                BY CREATING A PAXONES ACCOUNT OR USING ANY PAXONES SERVICE, YOU CONFIRM THAT:
              </p>
              <ol className="list-decimal list-inside space-y-1 pl-2 font-medium">
                <li>YOU HAVE READ THESE TERMS;</li>
                <li>YOU UNDERSTAND THESE TERMS;</li>
                <li>YOU AGREE TO FOLLOW THESE TERMS;</li>
                <li>YOU UNDERSTAND THE RISKS OF DIGITAL ASSETS;</li>
                <li>YOU ACCEPT RESPONSIBILITY FOR YOUR ACCOUNT;</li>
                <li>YOU ACCEPT RESPONSIBILITY FOR YOUR TRANSACTIONS;</li>
                <li>YOU WILL NOT USE PAXONES FOR FRAUDULENT OR PROHIBITED ACTIVITY; AND</li>
                <li>YOU AGREE THAT PAXONES MAY TAKE REASONABLE ACTIONS TO PROTECT ITS PLATFORM, USERS, AND SERVICES.</li>
              </ol>
            </section>

          </div>

          {/* Footer Sign-off */}
          <div className="border-t border-slate-200 dark:border-[#1e2640] pt-8 mt-12 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500 dark:text-slate-400">
            <div>
              <strong>PAXONES™</strong> &bull; All Rights Reserved.
            </div>
            <div>
              Effective Date: January 1, 2026 &bull; Last Updated: September 9, 2026
            </div>
          </div>

        </div>
      </main>
      <Footer />
    </div>
  );
}
