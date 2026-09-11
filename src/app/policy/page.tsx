import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import Link from "next/link";
import { Shield, Lock, FileText, AlertTriangle, Eye, CheckCircle2 } from "lucide-react";

export const metadata = {
  title: "Privacy Notice | Paxones™",
  description: "Learn how Paxones protects your personal data, identity verification, trading activity, and platform security.",
};

export default function PolicyPage() {
  return (
    <div className="flex flex-col min-h-screen bg-slate-50 dark:bg-[#07090e] text-slate-900 dark:text-slate-100 transition-colors">
      <Header />
      <main className="flex-grow container mx-auto px-4 py-12 md:py-16 max-w-4xl">
        <div className="bg-white dark:bg-[#0f1423] border border-slate-200 dark:border-[#1e2640] rounded-2xl p-6 sm:p-10 shadow-sm space-y-10">
          
          {/* Header & Date Badge */}
          <div className="border-b border-slate-200 dark:border-[#1e2640] pb-8">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs font-semibold rounded-full mb-4">
              <Shield className="w-3.5 h-3.5" />
              <span>Official Policy Document</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900 dark:text-white mb-3">
              PRIVACY NOTICE
            </h1>
            <div className="flex flex-wrap gap-y-1 gap-x-6 text-xs text-slate-500 dark:text-slate-400 font-mono">
              <span><strong>Effective Date:</strong> January 1, 2026</span>
              <span><strong>Last Updated:</strong> September 9, 2026</span>
            </div>
          </div>

          {/* Preamble */}
          <div className="space-y-4 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
            <p>
              Paxones™ (&ldquo;<strong>Paxones</strong>,&rdquo; &ldquo;<strong>we</strong>,&rdquo; &ldquo;<strong>us</strong>,&rdquo; or &ldquo;<strong>our</strong>&rdquo;) respects your privacy and is committed to protecting your Personal Data. This Privacy Notice explains how we collect, use, store, disclose, and protect information when you access or use the Paxones website, wallet services, P2P cryptocurrency trading platform, escrow services, marketplace, mobile applications, trade rooms, support channels, and other products, services, features, technologies, or functions made available by us (collectively, the &ldquo;<strong>Services</strong>&rdquo;).
            </p>
            <p>
              By accessing or using the Services, you acknowledge that you have read and understood this Privacy Notice. If you do not agree with this Notice, you should not access or use the Services.
            </p>
            <p>
              Our Services may vary depending on your jurisdiction, applicable laws, and regulatory requirements. The availability of a Service does not necessarily mean that all laws of your country or jurisdiction apply to Paxones or that every Service is available in every jurisdiction.
            </p>
            <p>
              This Notice may be provided in different languages. To the extent permitted by applicable law, the English-language version will prevail in the event of any inconsistency.
            </p>
          </div>

          <hr className="border-slate-200 dark:border-[#1e2640]" />

          {/* Section 1 */}
          <section className="space-y-5 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <span className="text-amber-500 font-mono">1.</span> Personal Data We Collect
            </h2>
            <p>
              &ldquo;<strong>Personal Data</strong>&rdquo; means information that identifies, relates to, describes, or can reasonably be associated with an identifiable individual.
            </p>
            <p>
              We collect information that is reasonably necessary to operate, secure, and improve our Services, comply with applicable laws, prevent fraud, and facilitate P2P transactions.
            </p>

            <div className="space-y-4 pl-2">
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-2">1.1 Biographical and Identity Information</h3>
                <p className="mb-2">Depending on the Services you use, we may collect:</p>
                <ul className="list-disc pl-5 space-y-1 text-slate-600 dark:text-slate-400">
                  <li>Legal full name;</li>
                  <li>Email address;</li>
                  <li>Country of residence;</li>
                  <li>Residential or mailing address;</li>
                  <li>Date of birth;</li>
                  <li>Government-issued identification information;</li>
                  <li>Identification document number;</li>
                  <li>Identification document type;</li>
                  <li>Photographs or identity-verification images;</li>
                </ul>
              </div>

              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-2">1.2 Account Information</h3>
                <p className="mb-2">When you create or maintain a Paxones account, we may collect:</p>
                <ul className="list-disc pl-5 space-y-1 text-slate-600 dark:text-slate-400">
                  <li>Username or unique handle;</li>
                  <li>Email address;</li>
                  <li>Password information, including securely stored password hashes;</li>
                  <li>Profile information;</li>
                  <li>Profile picture, if provided;</li>
                  <li>Account creation date;</li>
                  <li>Account status;</li>
                  <li>Default currency;</li>
                  <li>Time zone;</li>
                  <li>Language preferences;</li>
                  <li>Two-factor authentication (2FA) metadata;</li>
                  <li>Authentication and account-security information.</li>
                </ul>
                <p className="mt-2 text-xs text-amber-600 dark:text-amber-400 font-medium">We do not store your password in plain text.</p>
              </div>

              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-2">1.3 KYC and Identity Verification Information</h3>
                <p className="mb-2">
                  Where identity verification is required, Paxones may use authorized third-party identity verification providers to conduct KYC and related verification procedures.
                </p>
                <p className="mb-2">Depending on the verification process, information may include:</p>
                <ul className="list-disc pl-5 space-y-1 text-slate-600 dark:text-slate-400">
                  <li>Government-issued identification documents;</li>
                  <li>Legal name;</li>
                  <li>Date of birth;</li>
                  <li>Document number;</li>
                  <li>Photographs;</li>
                  <li>Facial verification information;</li>
                  <li>Verification status and related compliance information.</li>
                </ul>
                <p className="mt-2 text-xs text-slate-500">
                  KYC information may be processed by our identity-verification providers on our behalf and in accordance with applicable data-processing arrangements and applicable law.
                </p>
              </div>

              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-2">1.4 Trading and Account Activity</h3>
                <p className="mb-2">We may collect information relating to your use of Paxones, including:</p>
                <ul className="list-disc pl-5 space-y-1 text-slate-600 dark:text-slate-400">
                  <li>Trades initiated or completed;</li>
                  <li>Trade offers;</li>
                  <li>Offer terms;</li>
                  <li>Trade instructions;</li>
                  <li>Trade status;</li>
                  <li>Escrow activity;</li>
                  <li>Transaction history;</li>
                  <li>Payment status;</li>
                  <li>Account notifications;</li>
                  <li>Account restrictions or status;</li>
                  <li>Fees and charges;</li>
                  <li>Dispute history;</li>
                  <li>Communications with Paxones support.</li>
                </ul>
              </div>

              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-2">1.5 Wallet and Digital Asset Information</h3>
                <p className="mb-2">When you use our digital-asset or escrow-related Services, we may collect:</p>
                <ul className="list-disc pl-5 space-y-1 text-slate-600 dark:text-slate-400">
                  <li>Custodial wallet deposit addresses;</li>
                  <li>Wallet balances maintained within Paxones systems;</li>
                  <li>Blockchain addresses associated with transactions;</li>
                  <li>Blockchain transaction hashes;</li>
                  <li>Digital assets deposited or withdrawn;</li>
                  <li>Deposit and withdrawal records;</li>
                  <li>On-chain transaction information;</li>
                  <li>Internal ledger balances;</li>
                  <li>Off-chain ledger transactions;</li>
                  <li>Escrow settlement records.</li>
                </ul>
                <p className="mt-2 text-xs text-slate-500">
                  Blockchain transactions may be publicly visible on the relevant blockchain network and may be permanent or difficult to remove. Information recorded on a public blockchain may therefore remain accessible independently of Paxones.
                </p>
              </div>

              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-2">1.6 Trade Communications and Attachments</h3>
                <p className="mb-2">To operate our trading and dispute-resolution systems, we may collect and retain:</p>
                <ul className="list-disc pl-5 space-y-1 text-slate-600 dark:text-slate-400">
                  <li>Trade-room chat messages;</li>
                  <li>Messenger communications;</li>
                  <li>Support communications;</li>
                  <li>Trade instructions;</li>
                  <li>Payment-verification receipts;</li>
                  <li>Proof-of-payment files;</li>
                  <li>Screenshots;</li>
                  <li>Images;</li>
                  <li>Documents;</li>
                  <li>Other files uploaded to a trade or dispute;</li>
                  <li>Communications submitted during dispute resolution.</li>
                </ul>
                <p className="mt-2 text-xs text-slate-500">Users should not submit unnecessary sensitive information through trade rooms, chat, support tickets, or dispute submissions.</p>
              </div>

              <div className="bg-slate-50 dark:bg-[#151a2d] p-4 sm:p-5 rounded-xl border border-slate-200 dark:border-slate-800">
                <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-2 flex items-center gap-2">
                  <Lock className="w-4 h-4 text-amber-500" />
                  <span>1.7 Device, Technical, and Security Information</span>
                </h3>
                <p className="mb-2">We collect technical information such as:</p>
                <ul className="list-disc pl-5 space-y-1 text-slate-600 dark:text-slate-400">
                  <li>IP address;</li>
                  <li>Browser type and version;</li>
                  <li>Operating system;</li>
                  <li>Device type;</li>
                  <li>Device characteristics;</li>
                  <li>Device identifiers;</li>
                  <li>Browser and device signatures;</li>
                  <li>Device fingerprints where legally permitted;</li>
                  <li>Authentication logs;</li>
                  <li>Login and logout information;</li>
                  <li>Date and time of access;</li>
                  <li>Session information;</li>
                  <li>Language preferences;</li>
                  <li>Network information;</li>
                  <li>Error and diagnostic information;</li>
                  <li>Security events;</li>
                  <li>Information relating to suspicious or abnormal activity.</li>
                </ul>
                <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                  We use this information primarily to secure accounts, detect fraud, prevent abuse, investigate suspicious activity, and protect Paxones and its users.
                </p>
              </div>
            </div>
          </section>

          <hr className="border-slate-200 dark:border-[#1e2640]" />

          {/* Section 2 */}
          <section className="space-y-4 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <span className="text-amber-500 font-mono">2.</span> How We Collect Personal Data
            </h2>
            <p>We may collect Personal Data from several sources:</p>
            <div className="space-y-3 pl-2">
              <p><strong>Directly From You:</strong> We collect information when you create an account, complete KYC verification, update your profile, initiate or participate in a trade, deposit or withdraw digital assets, communicate with support, submit documents or evidence, participate in a dispute, contact us, or use our Website or Services.</p>
              <p><strong>From Service Providers:</strong> We may receive information from third-party providers that assist us with identity verification, fraud detection, security, hosting and infrastructure, data storage, customer support, analytics, payment or transaction-related services, communications, and technical operations.</p>
              <p><strong>From Other Users:</strong> We may receive information from other users in connection with P2P trades, trade communications, disputes, payment verification, reports of suspicious activity, or uploaded evidence.</p>
              <p><strong>From Blockchain Networks:</strong> When digital assets are transferred through a blockchain network, we may receive publicly available blockchain information, including transaction hashes, wallet addresses, amounts, timestamps, and other information recorded on the relevant network.</p>
              <p><strong>From Public or Third-Party Sources:</strong> Where permitted by law, we may obtain information from public sources, compliance databases, fraud-prevention services, identity-verification providers, and other legitimate third-party sources.</p>
            </div>
          </section>

          <hr className="border-slate-200 dark:border-[#1e2640]" />

          {/* Section 3 */}
          <section className="space-y-4 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <span className="text-amber-500 font-mono">3.</span> How We Use Personal Data
            </h2>
            <p>We may collect, process, use, and retain Personal Data for the following purposes:</p>
            <div className="space-y-3 pl-2">
              <div>
                <h4 className="font-semibold text-slate-900 dark:text-white">Providing and Operating the Services</h4>
                <p className="text-slate-600 dark:text-slate-400">To create and maintain accounts, authenticate users, process transactions, facilitate P2P trading, operate escrow services, maintain account and ledger records, process deposits and withdrawals, provide customer support, facilitate trade communications, process disputes, and maintain the security and functionality of the Services.</p>
              </div>
              <div>
                <h4 className="font-semibold text-slate-900 dark:text-white">Identity Verification and Compliance</h4>
                <p className="text-slate-600 dark:text-slate-400">To conduct KYC verification, verify identity, prevent fraud, detect suspicious activity, prevent money laundering and other prohibited activity, meet applicable legal, regulatory, and compliance requirements, respond to lawful requests from authorities, and enforce our Terms, policies, and procedures.</p>
              </div>
              <div>
                <h4 className="font-semibold text-slate-900 dark:text-white">Security and Fraud Prevention</h4>
                <p className="text-slate-600 dark:text-slate-400">We use information such as IP addresses, device information, authentication records, transaction history, and account activity to detect unauthorized access, identify suspicious behavior, prevent account takeover, detect fraudulent transactions, prevent abuse of the platform, investigate security incidents, protect users and Paxones, and enforce account-security controls.</p>
              </div>
              <div>
                <h4 className="font-semibold text-slate-900 dark:text-white">Dispute Resolution</h4>
                <p className="text-slate-600 dark:text-slate-400">Personal Data, trade records, communications, payment evidence, transaction information, and documents may be used to investigate and resolve disputes between users. Disputes may be reviewed based on the information and evidence available to Paxones at the time of review.</p>
              </div>
            </div>
          </section>

          <hr className="border-slate-200 dark:border-[#1e2640]" />

          {/* Section 4 */}
          <section className="space-y-4 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <span className="text-amber-500 font-mono">4.</span> Dispute Resolution and Evidence
            </h2>
            <p>
              Paxones may provide dispute-resolution mechanisms for eligible P2P transactions. Where a dispute is opened, users may be required to provide supporting evidence, documents, payment receipts, screenshots, transaction records, communications, or other information within the timeframe specified by Paxones.
            </p>
            <div className="bg-slate-50 dark:bg-[#151a2d] p-4 sm:p-5 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2">
              <h3 className="font-semibold text-slate-900 dark:text-white">Evidence-Based Decisions</h3>
              <p>Dispute outcomes are determined based on the evidence and information available to Paxones, including, where applicable:</p>
              <ul className="list-disc pl-5 space-y-1 text-slate-600 dark:text-slate-400">
                <li>Trade-room communications;</li>
                <li>Payment verification;</li>
                <li>Proof-of-payment documents;</li>
                <li>Blockchain transaction records;</li>
                <li>Account and ledger records;</li>
                <li>Transaction timestamps;</li>
                <li>Information provided by the parties;</li>
                <li>KYC or verification information;</li>
                <li>Other relevant documentation or technical records.</li>
              </ul>
              <p className="pt-2 font-medium text-amber-600 dark:text-amber-400">
                Users are responsible for providing complete and accurate evidence within the applicable dispute deadline.
              </p>
              <p className="text-xs text-slate-500">
                If a user fails to provide requested evidence or documentation within the required timeframe, Paxones may make a determination based on the information available at that time. Paxones does not guarantee that a particular party will receive a favorable dispute outcome and does not act as a court, arbitrator, bank, payment institution, or legal representative of either party merely by providing a platform-based dispute process.
              </p>
            </div>
          </section>

          <hr className="border-slate-200 dark:border-[#1e2640]" />

          {/* Section 5 */}
          <section className="space-y-4 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <span className="text-amber-500 font-mono">5.</span> Legal Bases for Processing
            </h2>
            <p>Where applicable law requires a legal basis for processing Personal Data, Paxones may rely on one or more of the following:</p>
            <ul className="list-disc pl-5 space-y-2 text-slate-600 dark:text-slate-400">
              <li><strong>Performance of a contract:</strong> where processing is necessary to provide Services requested by you or perform our agreement with you;</li>
              <li><strong>Legal obligations:</strong> where processing is necessary to comply with applicable laws, regulations, court orders, regulatory requirements, KYC/AML obligations, or lawful requests;</li>
              <li><strong>Legitimate interests:</strong> where processing is necessary for fraud prevention, security, platform integrity, service improvement, dispute resolution, or protection of Paxones and its users;</li>
              <li><strong>Consent:</strong> where we request and obtain your consent for a particular processing activity;</li>
              <li><strong>Protection of rights and safety:</strong> where processing is necessary to protect users, Paxones, or other persons.</li>
            </ul>
            <p className="text-xs text-slate-500">
              Where we rely on consent, you may withdraw consent where permitted by law. Withdrawal of consent does not affect the lawfulness of processing carried out before withdrawal.
            </p>
          </section>

          <hr className="border-slate-200 dark:border-[#1e2640]" />

          {/* Section 6 */}
          <section className="space-y-4 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <span className="text-amber-500 font-mono">6.</span> How We Share Personal Data
            </h2>
            <p className="font-semibold text-slate-900 dark:text-white">Paxones does not sell or rent your Personal Data.</p>
            <p>We may share Personal Data where reasonably necessary to provide the Services, protect the platform, comply with legal obligations, or perform activities described in this Notice.</p>
            <div className="space-y-3 pl-2">
              <div>
                <h4 className="font-semibold text-slate-900 dark:text-white">Service Providers and Data Processors</h4>
                <p className="text-slate-600 dark:text-slate-400">We may share Personal Data with trusted service providers that process information on our behalf, including providers supporting cloud and database infrastructure, identity verification services, KYC and compliance, security and fraud prevention, secure cloud storage, customer support, communications, and technical operations.</p>
              </div>
              <div>
                <h4 className="font-semibold text-slate-900 dark:text-white">Legal and Regulatory Requests</h4>
                <p className="text-slate-600 dark:text-slate-400">We may disclose information where reasonably necessary to comply with applicable law, respond to lawful government or regulatory requests, comply with court orders or legal processes, investigate suspected fraud or illegal activity, or protect the rights, property, or safety of Paxones, users, or others.</p>
              </div>
              <div>
                <h4 className="font-semibold text-slate-900 dark:text-white">Business Transactions</h4>
                <p className="text-slate-600 dark:text-slate-400">If Paxones is involved in a merger, acquisition, restructuring, financing, sale of assets, bankruptcy, or similar transaction, Personal Data may be transferred as part of that transaction, subject to applicable law.</p>
              </div>
            </div>
          </section>

          <hr className="border-slate-200 dark:border-[#1e2640]" />

          {/* Section 7 */}
          <section className="space-y-4 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <span className="text-amber-500 font-mono">7.</span> International Transfers
            </h2>
            <p>
              Paxones and its service providers may process or store Personal Data in countries other than the country where you reside. Data-protection laws may differ between jurisdictions. Where required by applicable law, we will implement appropriate safeguards for international transfers of Personal Data.
            </p>
          </section>

          <hr className="border-slate-200 dark:border-[#1e2640]" />

          {/* Section 8 */}
          <section className="space-y-4 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <span className="text-amber-500 font-mono">8.</span> Cookies and Similar Technologies
            </h2>
            <p>
              Paxones may use cookies, local storage, device identifiers, and similar technologies to operate and secure the Website and Services (for account authentication, session management, security, fraud prevention, website functionality, preferences, and performance monitoring). You may be able to control cookies through your browser or device settings. Disabling certain cookies may affect the availability or functionality of some Services.
            </p>
          </section>

          <hr className="border-slate-200 dark:border-[#1e2640]" />

          {/* Section 9 */}
          <section className="space-y-4 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <span className="text-amber-500 font-mono">9.</span> Data Security
            </h2>
            <p>
              Paxones implements technical and organizational safeguards designed to protect Personal Data against unauthorized access, alteration, disclosure, misuse, or destruction:
            </p>
            <ul className="list-disc pl-5 space-y-1 text-slate-600 dark:text-slate-400">
              <li>TLS encryption for data transmitted over supported connections;</li>
              <li>Encryption of stored information using industry-standard encryption technologies;</li>
              <li>Access controls and Row-Level Security (RLS);</li>
              <li>Two-factor authentication (TOTP/2FA);</li>
              <li>Restricted access to sensitive systems;</li>
              <li>Security monitoring and authentication logging;</li>
              <li>Fraud and abuse detection;</li>
              <li>Secure infrastructure and storage controls.</li>
            </ul>
            <p className="text-xs text-slate-500">
              Sensitive authentication secrets, including applicable TOTP/2FA information, are stored using appropriate security controls. You should use a strong, unique password, enable 2FA where available, protect your authentication credentials, and immediately notify Paxones if you suspect unauthorized access to your account.
            </p>
          </section>

          <hr className="border-slate-200 dark:border-[#1e2640]" />

          {/* Section 10 */}
          <section className="space-y-4 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <span className="text-amber-500 font-mono">10.</span> Data Retention
            </h2>
            <p>
              We retain Personal Data for as long as reasonably necessary to provide the Services, maintain account and transaction records, resolve disputes, prevent fraud and abuse, meet legal and regulatory obligations, maintain financial and accounting records, enforce agreements and policies, protect our legitimate interests, or resolve claims or legal proceedings.
            </p>
            <p className="text-xs text-slate-500">
              Certain information may be retained after account closure where required by law or reasonably necessary for compliance, fraud prevention, dispute resolution, security, accounting, or legal purposes. Blockchain transactions may be permanently recorded on public blockchain networks and generally cannot be deleted or modified by Paxones.
            </p>
          </section>

          <hr className="border-slate-200 dark:border-[#1e2640]" />

          {/* Section 11 */}
          <section className="space-y-4 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <span className="text-amber-500 font-mono">11.</span> Your Privacy Rights
            </h2>
            <p>Depending on your jurisdiction and applicable law, you may have rights including:</p>
            <ul className="list-disc pl-5 space-y-1 text-slate-600 dark:text-slate-400">
              <li>The right to request access to Personal Data we hold about you;</li>
              <li>The right to request correction of inaccurate or incomplete information;</li>
              <li>The right to request deletion of certain Personal Data;</li>
              <li>The right to request restriction of certain processing;</li>
              <li>The right to object to certain processing;</li>
              <li>The right to request portability of certain Personal Data;</li>
              <li>The right to withdraw consent where processing is based on consent;</li>
              <li>The right to lodge a complaint with an applicable data-protection authority.</li>
            </ul>
            <p className="text-xs text-slate-500">
              These rights are not absolute and may be subject to legal, regulatory, security, fraud-prevention, contractual, or other legitimate restrictions (for example, retention of certain transaction and compliance records).
            </p>
          </section>

          <hr className="border-slate-200 dark:border-[#1e2640]" />

          {/* Section 12 */}
          <section className="space-y-4 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <span className="text-amber-500 font-mono">12.</span> Children
            </h2>
            <p>
              The Services are not intended for individuals under 18 years of age. We do not knowingly permit individuals under 18 to create or maintain accounts or use our Services where such use is prohibited by applicable law. If we learn that Personal Data belonging to an individual under 18 has been collected contrary to applicable requirements, we may take appropriate steps to delete the information and terminate the associated account.
            </p>
          </section>

          <hr className="border-slate-200 dark:border-[#1e2640]" />

          {/* Section 13 */}
          <section className="space-y-4 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <span className="text-amber-500 font-mono">13.</span> Third-Party Services and Websites
            </h2>
            <p>
              The Services may contain links to or integrations with third-party websites, applications, services, wallets, identity-verification providers, payment providers, or other platforms. Paxones is not responsible for the privacy practices of third parties that operate independently from Paxones. We encourage you to review the privacy notices and terms of any third-party service before providing information to them.
            </p>
          </section>

          <hr className="border-slate-200 dark:border-[#1e2640]" />

          {/* Section 14 */}
          <section className="space-y-4 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <span className="text-amber-500 font-mono">14.</span> Do Not Track
            </h2>
            <p>
              Unless otherwise required by applicable law, our Website may not respond to browser-based &ldquo;Do Not Track&rdquo; signals or similar mechanisms.
            </p>
          </section>

          <hr className="border-slate-200 dark:border-[#1e2640]" />

          {/* Section 15 */}
          <section className="space-y-4 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <span className="text-amber-500 font-mono">15.</span> Marketing and Communications
            </h2>
            <p>
              We may send transactional and service-related communications necessary to operate your account (security alerts, login notifications, transaction notifications, trade notifications, dispute notifications, account-related messages, policy updates, and service announcements). Where permitted by law, we may also send marketing communications. You may opt out of promotional communications without affecting essential transactional or security communications.
            </p>
          </section>

          <hr className="border-slate-200 dark:border-[#1e2640]" />

          {/* Section 16 */}
          <section className="space-y-4 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <span className="text-amber-500 font-mono">16.</span> Accuracy of Information
            </h2>
            <p>
              You are responsible for ensuring that information submitted to Paxones is accurate, complete, and up to date. Providing false, misleading, incomplete, or fraudulent information may result in account restrictions, suspension, termination, dispute consequences, or other action permitted under our Terms and applicable law.
            </p>
          </section>

          <hr className="border-slate-200 dark:border-[#1e2640]" />

          {/* Section 17 */}
          <section className="space-y-4 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <span className="text-amber-500 font-mono">17.</span> Changes to This Privacy Notice
            </h2>
            <p>
              We may update this Privacy Notice from time to time to reflect changes in our Services, technology, business practices, legal requirements, regulatory requirements, or industry standards. When we make material changes, we may provide notice through the Website, email, account notifications, or another appropriate method.
            </p>
            <p>
              The &ldquo;Last Updated&rdquo; date at the beginning of this Notice indicates when the Notice was most recently revised. Your continued use of the Services after an updated Privacy Notice becomes effective constitutes acknowledgment of the updated Notice, to the extent permitted by applicable law.
            </p>
          </section>

          <hr className="border-slate-200 dark:border-[#1e2640]" />

          {/* Section 18 */}
          <section className="space-y-4 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <span className="text-amber-500 font-mono">18.</span> Contact Us
            </h2>
            <p>
              If you have questions about this Privacy Notice or wish to exercise an applicable privacy right, please contact Paxones through the official support channels made available through the Website or your Paxones account:
            </p>
            <div className="p-4 bg-slate-50 dark:bg-[#151a2d] rounded-xl border border-slate-200 dark:border-slate-800">
              <p className="font-semibold text-slate-900 dark:text-white">Paxones Support &amp; Compliance Desk</p>
              <p className="text-slate-600 dark:text-slate-400 mt-1">
                Email:{' '}
                <a href="mailto:support@paxones.com" className="text-amber-600 dark:text-amber-400 underline font-mono">
                  support@paxones.com
                </a>
              </p>
            </div>
            <p className="text-xs text-slate-500">
              When submitting a privacy request, we may request sufficient information to verify your identity and protect your account and Personal Data from unauthorized disclosure. Information collected solely to verify a privacy request will be used for verification and related security purposes.
            </p>
          </section>

          <hr className="border-slate-200 dark:border-[#1e2640]" />

          {/* Section 19 */}
          <section className="space-y-4 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <span className="text-amber-500 font-mono">19.</span> Data Controller
            </h2>
            <p>
              For purposes of applicable data-protection laws, the entity responsible for determining the purposes and means of processing your Personal Data may act as the relevant <strong>data controller</strong>. Where required by applicable law, additional information regarding the identity and contact details of the relevant data controller may be provided through the applicable Paxones Services or upon request.
            </p>
          </section>

          <hr className="border-slate-200 dark:border-[#1e2640]" />

          {/* Section 20 */}
          <section className="space-y-4 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <span className="text-amber-500 font-mono">20.</span> Important Privacy and Platform Notice
            </h2>
            <div className="p-5 bg-amber-500/5 border border-amber-500/20 rounded-xl space-y-3">
              <p className="font-semibold text-slate-900 dark:text-white">
                Paxones collects and processes Personal Data primarily to provide a secure P2P trading, escrow, transaction, identity-verification, and dispute-resolution environment.
              </p>
              <p className="text-slate-600 dark:text-slate-400 text-xs leading-relaxed">
                Paxones does not sell, rent, or monetize Personal Data as a commercial data product. However, information may be disclosed or processed where reasonably necessary to operate the Services, comply with legal and regulatory obligations, prevent fraud and abuse, protect users and the platform, resolve disputes, enforce our agreements, or use authorized service providers.
              </p>
              <p className="text-xs text-slate-500">
                Nothing in this Privacy Notice is intended to exclude, restrict, or waive any right, remedy, liability, or obligation that cannot lawfully be excluded or restricted under applicable law.
              </p>
            </div>
          </section>

          {/* Bottom Back to Home / Terms Link */}
          <div className="border-t border-slate-200 dark:border-[#1e2640] pt-6 flex flex-wrap justify-between items-center gap-4 text-xs text-slate-500">
            <Link href="/" className="hover:text-amber-600 dark:hover:text-amber-400 underline">
              &larr; Back to Home
            </Link>
            <div className="flex gap-4">
              <Link href="/terms" className="hover:text-amber-600 dark:hover:text-amber-400 underline">
                Terms of Service
              </Link>
              <a href="mailto:support@paxones.com" className="hover:text-amber-600 dark:hover:text-amber-400 underline">
                Contact Privacy Desk
              </a>
            </div>
          </div>

        </div>
      </main>
      <Footer />
    </div>
  );
}
