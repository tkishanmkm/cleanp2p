import { formatCryptoAmount } from '@/lib/trade-system-messages';

type TemplateSet = {
  badge: string;
  paymentMethodLabel: string;
  systemTitle: string;
  initiatedTitle: string;
  completedTitle: string;
  cancelledTitle: string;
  expiredTitle: string;
  disputedTitle: string;
  positiveFeedbackTitle: string;
  negativeFeedbackTitle: string;
  blockedTitle: string;
  issueTitle: string;
  paidTitle: string;
  moderatorTitle: string;
  blockedMessageTitle: string;
  securityTitle: string;
  initiated: string;
  completed: string;
  cancelled: string;
  expired: string;
  disputeIntro: string;
  disputeReason: string;
  disputeOpenedBy: string;
  disputeEvidence: string;
  disputeBuyerEvidence: string;
  disputeSellerEvidence: string;
  positiveFeedback: string;
  negativeFeedback: string;
  userBlocked: string;
  issueReported: string;
  issueCategory: string;
  issueDetails: string;
  markedPaid: string;
  moderatorJoined: string;
  messageBlocked: string;
  securityReminder: string;
};

const messages: Record<string, TemplateSet> = {
  en: {
    badge: 'Wayones SYSTEM', paymentMethodLabel: 'Payment method', systemTitle: 'Wayones System',
    initiatedTitle: 'Trade Initiated', completedTitle: 'Trade Completed',
    cancelledTitle: 'Trade Cancelled', expiredTitle: 'Trade Expired',
    disputedTitle: 'Official Dispute Notice', positiveFeedbackTitle: 'Positive Feedback Left',
    negativeFeedbackTitle: 'Negative Feedback Left', blockedTitle: 'User Blocked Notice',
    issueTitle: 'Issue Reported', paidTitle: 'Payment Confirmed',
    moderatorTitle: 'Wayones Moderator', blockedMessageTitle: 'Security Alert: Message Blocked',
    securityTitle: 'Wayones Security Reminder',
    initiated: '🔒 TRADE INITIATED\n------------------------\n• {amount} {coin} is safely held in Wayones Escrow.\n• Buyer (@{buyer}): Transfer payment using the seller’s instructions before the timer expires, then select “I have paid”.\n• Seller (@{seller}): Do NOT release escrow until you verify the incoming funds in your own account or statement.\n• Security: Never share passwords or one-time codes, and keep trade communication on Wayones.',
    completed: '@{seller} sold {amount} {coin} successfully to @{buyer}.\n@{buyer} bought {amount} {coin} successfully from @{seller}.',
    cancelled: 'Trade cancelled. Do not send or pay for this trade. If you have already paid, do not abandon the situation. Contact Wayones Support for assistance.',
    expired: '⚠️ TRADE EXPIRED (PAYMENT TIME EXCEEDED)\n----------------------------------------\nThis trade expired because the payment timer ended without confirmed payment.\n• DO NOT MAKE PAYMENT: The coin is no longer held in escrow.\n• IF YOU ALREADY PAID: Do not pay again. Contact Wayones Support and provide your payment proof.',
    disputeIntro: 'This trade is now in dispute.',
    disputeReason: 'Reason: {reason}',
    disputeOpenedBy: 'Dispute opened by: @{opener}',
    disputeEvidence: 'Please submit the requested evidence and supporting records within the stated timeframe. Keep all evidence and communication inside Wayones. Never share passwords, one-time codes, private keys or recovery phrases.',
    disputeBuyerEvidence: 'Buyer: Upload payment proof, such as an official receipt, statement or transaction reference.',
    disputeSellerEvidence: 'Seller: Upload the relevant account statement or transaction history showing whether the payment was received.',
    positiveFeedback: '@{opener} left positive feedback{comment}.',
    negativeFeedback: '@{opener} left negative feedback{comment}.',
    userBlocked: '@{opener} ({initiatorRole}) blocked @{blocked} ({targetRole}). Do not cancel or release the trade if funds were sent or received.',
    issueReported: '@{opener} reported an issue.',
    issueCategory: 'Category: {category}',
    issueDetails: 'Details: {details}',
    markedPaid: 'Buyer @{buyer} has marked the trade as paid. @{seller}, verify the payment in your receiving account before releasing escrow.',
    moderatorJoined: 'Wayones Moderator joined the trade chat.',
    messageBlocked: 'Message blocked: For your security, off-platform communication and trading instructions are not allowed in Wayones Trade Chat. Keep trade-related communication inside Wayones.',
    securityReminder: 'Wayones Security Reminder: Never share your password, two-factor authentication code, private key, seed phrase or recovery phrase. Wayones Support will never ask you to disclose these credentials.',
  },
  'zh-CN': {
    badge: 'Wayones 系统', paymentMethodLabel: '付款方式', systemTitle: 'Wayones 系统',
    initiatedTitle: '交易已发起', completedTitle: '交易已完成',
    cancelledTitle: '交易已取消', expiredTitle: '交易已过期',
    disputedTitle: '官方争议通知', positiveFeedbackTitle: '已收到正面评价',
    negativeFeedbackTitle: '已收到负面评价', blockedTitle: '用户屏蔽通知',
    issueTitle: '问题已报告', paidTitle: '付款已标记',
    moderatorTitle: 'Wayones 版主', blockedMessageTitle: '安全提醒：消息已拦截',
    securityTitle: 'Wayones 安全提醒',
    initiated: '🔒 交易已发起\n------------------------\n• {amount} {coin} 已安全锁定在 Wayones 托管中。\n• 买家（@{buyer}）：请在计时结束前按照卖家的付款说明完成付款，然后选择“我已付款”。\n• 卖家（@{seller}）：在您自己的账户或对账单中确认收到款项之前，请勿释放托管资产。\n• 安全提示：切勿分享密码或一次性验证码，所有交易沟通请留在 Wayones。',
    completed: '@{seller} 已成功向 @{buyer} 出售 {amount} {coin}。\n@{buyer} 已成功从 @{seller} 购买 {amount} {coin}。',
    cancelled: '交易已取消。请勿为此交易转账或付款。如果您已经付款，请勿放弃处理。请联系 Wayones 客服获取帮助。',
    expired: '⚠️ 交易已过期（付款时间已结束）\n----------------------------------------\n由于付款计时结束且未确认付款，此交易已过期。\n• 请勿付款：该资产已不再由托管服务锁定。\n• 如果您已经付款：请勿再次付款。请联系 Wayones 客服并提供付款凭证。',
    disputeIntro: '此交易现已进入争议处理。',
    disputeReason: '原因：{reason}',
    disputeOpenedBy: '争议发起人：@{opener}',
    disputeEvidence: '请在规定时间内提交所需证据及相关记录。所有证据和沟通请留在 Wayones。切勿分享密码、一次性验证码、私钥或恢复短语。',
    disputeBuyerEvidence: '买家：请上传付款证明，例如正式收据、银行对账单或交易参考编号。',
    disputeSellerEvidence: '卖家：请上传相关账户对账单或交易记录，以说明是否收到款项。',
    positiveFeedback: '@{opener} 留下了正面评价{comment}。',
    negativeFeedback: '@{opener} 留下了负面评价{comment}。',
    userBlocked: '@{opener}（{initiatorRole}）屏蔽了 @{blocked}（{targetRole}）。如果已发送或收到资金，请勿取消或释放交易。',
    issueReported: '@{opener} 报告了一个问题。',
    issueCategory: '类别：{category}',
    issueDetails: '详情：{details}',
    markedPaid: '买家 @{buyer} 已将交易标记为已付款。@{seller}，请先在收款账户中核实到账，再释放托管资产。',
    moderatorJoined: 'Wayones 版主已加入交易聊天。',
    messageBlocked: '消息已拦截：为保障您的安全，Wayones 交易聊天禁止站外联系或站外交易指示。请在 Wayones 内进行所有交易沟通。',
    securityReminder: 'Wayones 安全提醒：切勿向他人透露密码、双重验证代码、私钥、助记词或恢复短语。Wayones 客服绝不会要求您提供这些凭据。',
  },
  'zh-TW': {
    badge: 'Wayones 系統', paymentMethodLabel: '付款方式', systemTitle: 'Wayones 系統',
    initiatedTitle: '交易已發起', completedTitle: '交易已完成',
    cancelledTitle: '交易已取消', expiredTitle: '交易已過期',
    disputedTitle: '官方爭議通知', positiveFeedbackTitle: '已收到正面評價',
    negativeFeedbackTitle: '已收到負面評價', blockedTitle: '使用者封鎖通知',
    issueTitle: '問題已回報', paidTitle: '付款已標記',
    moderatorTitle: 'Wayones 版主', blockedMessageTitle: '安全警示：訊息已封鎖',
    securityTitle: 'Wayones 安全提醒',
    initiated: '🔒 交易已發起\n------------------------\n• {amount} {coin} 已安全鎖定於 Wayones 託管中。\n• 買家（@{buyer}）：請在計時結束前依照賣家的付款指示完成付款，然後選擇「我已付款」。\n• 賣家（@{seller}）：在您自己的帳戶或對帳單確認收到款項前，請勿釋放託管資產。\n• 安全提醒：切勿分享密碼或一次性驗證碼，所有交易溝通請留在 Wayones。',
    completed: '@{seller} 已成功向 @{buyer} 出售 {amount} {coin}。\n@{buyer} 已成功向 @{seller} 購買 {amount} {coin}。',
    cancelled: '交易已取消。請勿為此交易轉帳或付款。若您已經付款，請勿放棄處理。請聯絡 Wayones 客服尋求協助。',
    expired: '⚠️ 交易已過期（付款時間已結束）\n----------------------------------------\n由於付款計時結束且尚未確認付款，此交易已過期。\n• 請勿付款：該資產已不再由託管服務鎖定。\n• 若您已經付款：請勿再次付款。請聯絡 Wayones 客服並提供付款證明。',
    disputeIntro: '此交易目前處於爭議處理中。',
    disputeReason: '原因：{reason}',
    disputeOpenedBy: '爭議發起人：@{opener}',
    disputeEvidence: '請於指定期限內提交所需證據及相關紀錄。所有證據和溝通請留在 Wayones。切勿分享密碼、一次性驗證碼、私鑰或復原詞組。',
    disputeBuyerEvidence: '買家：請上傳付款證明，例如正式收據、銀行對帳單或交易參考編號。',
    disputeSellerEvidence: '賣家：請上傳相關帳戶對帳單或交易紀錄，以說明是否收到款項。',
    positiveFeedback: '@{opener} 留下了正面評價{comment}。',
    negativeFeedback: '@{opener} 留下了負面評價{comment}。',
    userBlocked: '@{opener}（{initiatorRole}）封鎖了 @{blocked}（{targetRole}）。若已發送或收到資金，請勿取消或釋放交易。',
    issueReported: '@{opener} 回報了一個問題。',
    issueCategory: '類別：{category}',
    issueDetails: '詳細資訊：{details}',
    markedPaid: '買家 @{buyer} 已將交易標記為已付款。@{seller}，請先在收款帳戶確認入帳，再釋放託管資產。',
    moderatorJoined: 'Wayones 版主已加入交易聊天室。',
    messageBlocked: '訊息已封鎖：為保障您的安全，Wayones 交易聊天室禁止站外聯絡或站外交易指示。所有交易溝通請留在 Wayones。',
    securityReminder: 'Wayones 安全提醒：切勿向他人透露密碼、雙重驗證碼、私鑰、助記詞或復原詞組。Wayones 客服絕不會要求您提供這些憑證。',
  },
  'pt-BR': {
    badge: 'SISTEMA Wayones', paymentMethodLabel: 'Método de pagamento', systemTitle: 'Sistema Wayones',
    initiatedTitle: 'Negociação iniciada', completedTitle: 'Negociação concluída',
    cancelledTitle: 'Negociação cancelada', expiredTitle: 'Negociação expirada',
    disputedTitle: 'Aviso oficial de disputa', positiveFeedbackTitle: 'Avaliação positiva recebida',
    negativeFeedbackTitle: 'Avaliação negativa recebida', blockedTitle: 'Aviso de usuário bloqueado',
    issueTitle: 'Problema relatado', paidTitle: 'Pagamento marcado',
    moderatorTitle: 'Moderador Wayones', blockedMessageTitle: 'Alerta de segurança: mensagem bloqueada',
    securityTitle: 'Lembrete de segurança Wayones',
    initiated: '🔒 NEGOCIAÇÃO INICIADA\n------------------------\n• {amount} {coin} está protegido no Escrow da Wayones.\n• Comprador (@{buyer}): faça o pagamento seguindo as instruções do vendedor antes que o tempo termine e depois selecione “Já paguei”.\n• Vendedor (@{seller}): NÃO libere o escrow antes de confirmar o recebimento em sua própria conta ou extrato.\n• Segurança: nunca compartilhe senhas ou códigos únicos e mantenha a comunicação da negociação na Wayones.',
    completed: '@{seller} vendeu {amount} {coin} com sucesso para @{buyer}.\n@{buyer} comprou {amount} {coin} com sucesso de @{seller}.',
    cancelled: 'Negociação cancelada. Não envie nem pague por esta negociação. Se já efetuou o pagamento, não abandone a situação. Entre em contato com o suporte Wayones para obter ajuda.',
    expired: '⚠️ NEGOCIAÇÃO EXPIRADA (PRAZO DE PAGAMENTO ENCERRADO)\n----------------------------------------\nEsta negociação expirou porque o prazo terminou sem confirmação do pagamento.\n• NÃO PAGUE: a moeda não está mais bloqueada no escrow.\n• SE JÁ PAGOU: não pague novamente. Entre em contato com o suporte Wayones e apresente o comprovante.',
    disputeIntro: 'Esta negociação está em disputa.',
    disputeReason: 'Motivo: {reason}',
    disputeOpenedBy: 'Disputa aberta por: @{opener}',
    disputeEvidence: 'Envie as evidências e os registros solicitados dentro do prazo informado. Mantenha todas as evidências e comunicações na Wayones. Nunca compartilhe senhas, códigos únicos, chaves privadas ou frases de recuperação.',
    disputeBuyerEvidence: 'Comprador: envie o comprovante de pagamento, como recibo oficial, extrato ou referência da transação.',
    disputeSellerEvidence: 'Vendedor: envie o extrato da conta ou o histórico da transação relevante para demonstrar se o pagamento foi recebido.',
    positiveFeedback: '@{opener} deixou uma avaliação positiva{comment}.',
    negativeFeedback: '@{opener} deixou uma avaliação negativa{comment}.',
    userBlocked: '@{opener} ({initiatorRole}) bloqueou @{blocked} ({targetRole}). Não cancele nem libere a negociação se os fundos já foram enviados ou recebidos.',
    issueReported: '@{opener} relatou um problema.',
    issueCategory: 'Categoria: {category}',
    issueDetails: 'Detalhes: {details}',
    markedPaid: 'O comprador @{buyer} marcou a negociação como paga. @{seller}, confirme o recebimento na sua conta antes de liberar o escrow.',
    moderatorJoined: 'Um moderador Wayones entrou no chat da negociação.',
    messageBlocked: 'Mensagem bloqueada: por segurança, contatos externos e instruções de negociação fora da plataforma não são permitidos no Chat de Negociação Wayones. Mantenha a comunicação dentro da Wayones.',
    securityReminder: 'Lembrete de segurança Wayones: nunca compartilhe sua senha, código de autenticação de dois fatores, chave privada, frase-semente ou frase de recuperação. O suporte Wayones nunca solicitará essas credenciais.',
  },
  ko: {
    badge: 'Wayones 시스템', paymentMethodLabel: '결제 수단', systemTitle: 'Wayones 시스템',
    initiatedTitle: '거래 시작', completedTitle: '거래 완료',
    cancelledTitle: '거래 취소', expiredTitle: '거래 만료',
    disputedTitle: '공식 분쟁 안내', positiveFeedbackTitle: '긍정적인 평가 등록',
    negativeFeedbackTitle: '부정적인 평가 등록', blockedTitle: '사용자 차단 안내',
    issueTitle: '문제 신고', paidTitle: '결제 완료 표시',
    moderatorTitle: 'Wayones 중재자', blockedMessageTitle: '보안 경고: 메시지 차단',
    securityTitle: 'Wayones 보안 안내',
    initiated: '🔒 거래가 시작되었습니다\n------------------------\n• {amount} {coin}이(가) Wayones 에스크로에 안전하게 보관되었습니다.\n• 구매자 (@{buyer}): 타이머가 끝나기 전에 판매자의 안내에 따라 결제한 뒤 “결제했습니다”를 선택하세요.\n• 판매자 (@{seller}): 본인의 계좌나 명세서에서 입금을 확인하기 전에는 에스크로를 해제하지 마세요.\n• 보안: 비밀번호나 일회용 인증 코드를 공유하지 말고 거래 관련 대화는 Wayones 안에서 진행하세요.',
    completed: '@{seller}님이 @{buyer}님에게 {amount} {coin}을(를) 성공적으로 판매했습니다.\n@{buyer}님이 @{seller}님으로부터 {amount} {coin}을(를) 성공적으로 구매했습니다.',
    cancelled: '거래가 취소되었습니다. 이 거래에 대해 송금하거나 결제하지 마세요. 이미 결제했다면 상황을 방치하지 말고 Wayones 고객지원에 문의하세요.',
    expired: '⚠️ 거래 만료 (결제 시간 초과)\n----------------------------------------\n결제가 확인되지 않은 상태로 결제 시간이 종료되어 거래가 만료되었습니다.\n• 결제하지 마세요: 코인은 더 이상 에스크로에 보관되어 있지 않습니다.\n• 이미 결제했다면: 다시 결제하지 마세요. 결제 증빙을 준비해 Wayones 고객지원에 문의하세요.',
    disputeIntro: '이 거래는 분쟁 처리 중입니다.',
    disputeReason: '사유: {reason}',
    disputeOpenedBy: '분쟁 제기자: @{opener}',
    disputeEvidence: '안내된 기간 내에 요청된 증거와 관련 기록을 제출하세요. 모든 증거와 대화는 Wayones 안에 보관하세요. 비밀번호, 일회용 코드, 개인 키 또는 복구 문구를 공유하지 마세요.',
    disputeBuyerEvidence: '구매자: 공식 영수증, 명세서 또는 거래 참조 번호 등 결제 증빙을 업로드하세요.',
    disputeSellerEvidence: '판매자: 결제 수령 여부를 확인할 수 있는 관련 계좌 명세서 또는 거래 내역을 업로드하세요.',
    positiveFeedback: '@{opener}님이 긍정적인 평가를 남겼습니다{comment}.',
    negativeFeedback: '@{opener}님이 부정적인 평가를 남겼습니다{comment}.',
    userBlocked: '@{opener}님({initiatorRole})이(가) @{blocked}님({targetRole})을(를) 차단했습니다. 자금이 전송되었거나 수령되었다면 거래를 취소하거나 에스크로를 해제하지 마세요.',
    issueReported: '@{opener}님이 문제를 신고했습니다.',
    issueCategory: '분류: {category}',
    issueDetails: '세부 내용: {details}',
    markedPaid: '구매자 @{buyer}님이 거래를 결제 완료로 표시했습니다. @{seller}님은 에스크로를 해제하기 전에 수령 계좌에서 입금을 확인하세요.',
    moderatorJoined: 'Wayones 중재자가 거래 채팅에 참여했습니다.',
    messageBlocked: '메시지가 차단되었습니다. 보안을 위해 Wayones 거래 채팅에서는 외부 연락이나 플랫폼 밖 거래 지시가 허용되지 않습니다. 거래 관련 대화는 Wayones 안에서 진행하세요.',
    securityReminder: 'Wayones 보안 안내: 비밀번호, 2단계 인증 코드, 개인 키, 시드 구문 또는 복구 구문을 다른 사람과 공유하지 마세요. Wayones 고객지원은 이러한 정보를 절대 요청하지 않습니다.',
  },
  fr: {
    badge: 'SYSTÈME Wayones', paymentMethodLabel: 'Moyen de paiement', systemTitle: 'Système Wayones',
    initiatedTitle: 'Transaction initiée', completedTitle: 'Transaction terminée',
    cancelledTitle: 'Transaction annulée', expiredTitle: 'Transaction expirée',
    disputedTitle: 'Avis officiel de litige', positiveFeedbackTitle: 'Avis positif reçu',
    negativeFeedbackTitle: 'Avis négatif reçu', blockedTitle: 'Avis de blocage utilisateur',
    issueTitle: 'Problème signalé', paidTitle: 'Paiement marqué comme effectué',
    moderatorTitle: 'Modérateur Wayones', blockedMessageTitle: 'Alerte de sécurité : message bloqué',
    securityTitle: 'Rappel de sécurité Wayones',
    initiated: '🔒 TRANSACTION INITIÉE\n------------------------\n• {amount} {coin} est conservé en sécurité dans l’entiercement Wayones.\n• Acheteur (@{buyer}) : effectuez le paiement selon les instructions du vendeur avant la fin du délai, puis sélectionnez « J’ai payé ».\n• Vendeur (@{seller}) : ne libérez PAS l’entiercement avant d’avoir vérifié la réception des fonds sur votre propre compte ou relevé.\n• Sécurité : ne partagez jamais vos mots de passe ni vos codes à usage unique. Gardez les échanges liés à la transaction sur Wayones.',
    completed: '@{seller} a vendu {amount} {coin} avec succès à @{buyer}.\n@{buyer} a acheté {amount} {coin} avec succès auprès de @{seller}.',
    cancelled: 'Transaction annulée. N’envoyez aucun paiement pour cette transaction. Si vous avez déjà payé, n’abandonnez pas la situation. Contactez l’assistance Wayones pour obtenir de l’aide.',
    expired: '⚠️ TRANSACTION EXPIRÉE (DÉLAI DE PAIEMENT ÉCOULÉ)\n----------------------------------------\nCette transaction a expiré car le délai de paiement est terminé sans confirmation du paiement.\n• N’EFFECTUEZ PAS DE PAIEMENT : les fonds ne sont plus bloqués en entiercement.\n• SI VOUS AVEZ DÉJÀ PAYÉ : ne payez pas une deuxième fois. Contactez l’assistance Wayones avec votre justificatif de paiement.',
    disputeIntro: 'Cette transaction fait maintenant l’objet d’un litige.',
    disputeReason: 'Motif : {reason}',
    disputeOpenedBy: 'Litige ouvert par : @{opener}',
    disputeEvidence: 'Veuillez fournir les preuves et justificatifs demandés dans le délai indiqué. Conservez toutes les preuves et communications sur Wayones. Ne partagez jamais de mot de passe, code à usage unique, clé privée ou phrase de récupération.',
    disputeBuyerEvidence: 'Acheteur : téléversez une preuve de paiement, telle qu’un reçu officiel, un relevé ou une référence de transaction.',
    disputeSellerEvidence: 'Vendeur : téléversez le relevé de compte ou l’historique de transaction pertinent indiquant si le paiement a été reçu.',
    positiveFeedback: '@{opener} a laissé un avis positif{comment}.',
    negativeFeedback: '@{opener} a laissé un avis négatif{comment}.',
    userBlocked: '@{opener} ({initiatorRole}) a bloqué @{blocked} ({targetRole}). N’annulez pas et ne libérez pas la transaction si des fonds ont été envoyés ou reçus.',
    issueReported: '@{opener} a signalé un problème.',
    issueCategory: 'Catégorie : {category}',
    issueDetails: 'Détails : {details}',
    markedPaid: 'L’acheteur @{buyer} a indiqué que le paiement a été effectué. @{seller}, vérifiez la réception sur votre compte avant de libérer l’entiercement.',
    moderatorJoined: 'Un modérateur Wayones a rejoint le chat de la transaction.',
    messageBlocked: 'Message bloqué : pour votre sécurité, les communications hors plateforme et les instructions de transaction externes sont interdites dans le chat Wayones. Gardez les échanges liés à la transaction sur Wayones.',
    securityReminder: 'Rappel de sécurité Wayones : ne partagez jamais votre mot de passe, code d’authentification à deux facteurs, clé privée, phrase de récupération ou phrase mnémonique. L’assistance Wayones ne vous demandera jamais ces identifiants.',
  },
  es: {
    badge: 'SISTEMA Wayones', paymentMethodLabel: 'Método de pago', systemTitle: 'Sistema Wayones',
    initiatedTitle: 'Operación iniciada', completedTitle: 'Operación completada',
    cancelledTitle: 'Operación cancelada', expiredTitle: 'Operación vencida',
    disputedTitle: 'Aviso oficial de disputa', positiveFeedbackTitle: 'Reseña positiva recibida',
    negativeFeedbackTitle: 'Reseña negativa recibida', blockedTitle: 'Aviso de usuario bloqueado',
    issueTitle: 'Problema comunicado', paidTitle: 'Pago marcado como realizado',
    moderatorTitle: 'Moderador de Wayones', blockedMessageTitle: 'Alerta de seguridad: mensaje bloqueado',
    securityTitle: 'Aviso de seguridad de Wayones',
    initiated: '🔒 OPERACIÓN INICIADA\n------------------------\n• {amount} {coin} está protegido en el depósito de garantía de Wayones.\n• Comprador (@{buyer}): realiza el pago siguiendo las instrucciones del vendedor antes de que termine el temporizador y después selecciona «Ya he pagado».\n• Vendedor (@{seller}): NO liberes el depósito de garantía hasta confirmar la recepción en tu propia cuenta o extracto.\n• Seguridad: nunca compartas contraseñas ni códigos de un solo uso y mantén la comunicación de la operación en Wayones.',
    completed: '@{seller} vendió {amount} {coin} correctamente a @{buyer}.\n@{buyer} compró {amount} {coin} correctamente a @{seller}.',
    cancelled: 'Operación cancelada. No envíes dinero ni pagues esta operación. Si ya has pagado, no abandones la situación. Contacta con el soporte de Wayones para recibir ayuda.',
    expired: '⚠️ OPERACIÓN VENCIDA (TIEMPO DE PAGO AGOTADO)\n----------------------------------------\nLa operación venció porque terminó el plazo de pago sin que se confirmara el pago.\n• NO REALICES EL PAGO: la moneda ya no está bloqueada en el depósito de garantía.\n• SI YA PAGASTE: no vuelvas a pagar. Contacta con el soporte de Wayones y presenta el comprobante.',
    disputeIntro: 'Esta operación está ahora en disputa.',
    disputeReason: 'Motivo: {reason}',
    disputeOpenedBy: 'Disputa iniciada por: @{opener}',
    disputeEvidence: 'Envía las pruebas y los documentos solicitados dentro del plazo indicado. Mantén todas las pruebas y comunicaciones en Wayones. Nunca compartas contraseñas, códigos de un solo uso, claves privadas ni frases de recuperación.',
    disputeBuyerEvidence: 'Comprador: sube una prueba del pago, como un recibo oficial, un extracto o una referencia de la transacción.',
    disputeSellerEvidence: 'Vendedor: sube el extracto de cuenta o el historial de transacciones correspondiente para mostrar si recibiste el pago.',
    positiveFeedback: '@{opener} dejó una reseña positiva{comment}.',
    negativeFeedback: '@{opener} dejó una reseña negativa{comment}.',
    userBlocked: '@{opener} ({initiatorRole}) bloqueó a @{blocked} ({targetRole}). No canceles ni liberes la operación si se enviaron o recibieron fondos.',
    issueReported: '@{opener} comunicó un problema.',
    issueCategory: 'Categoría: {category}',
    issueDetails: 'Detalles: {details}',
    markedPaid: 'El comprador @{buyer} ha marcado la operación como pagada. @{seller}, verifica el ingreso en tu cuenta antes de liberar el depósito de garantía.',
    moderatorJoined: 'Un moderador de Wayones se ha unido al chat de la operación.',
    messageBlocked: 'Mensaje bloqueado: por tu seguridad, no se permiten comunicaciones externas ni instrucciones de negociación fuera de la plataforma en el chat de Wayones. Mantén toda la comunicación de la operación dentro de Wayones.',
    securityReminder: 'Aviso de seguridad de Wayones: nunca compartas tu contraseña, código de autenticación de dos factores, clave privada, frase semilla ni frase de recuperación. El soporte de Wayones nunca te pedirá estas credenciales.',
  },
  ru: {
    badge: 'СИСТЕМА Wayones', paymentMethodLabel: 'Способ оплаты', systemTitle: 'Система Wayones',
    initiatedTitle: 'Сделка начата', completedTitle: 'Сделка завершена',
    cancelledTitle: 'Сделка отменена', expiredTitle: 'Срок сделки истёк',
    disputedTitle: 'Официальное уведомление о споре', positiveFeedbackTitle: 'Оставлен положительный отзыв',
    negativeFeedbackTitle: 'Оставлен отрицательный отзыв', blockedTitle: 'Уведомление о блокировке пользователя',
    issueTitle: 'Сообщено о проблеме', paidTitle: 'Платёж отмечен как выполненный',
    moderatorTitle: 'Модератор Wayones', blockedMessageTitle: 'Предупреждение безопасности: сообщение заблокировано',
    securityTitle: 'Напоминание о безопасности Wayones',
    initiated: '🔒 СДЕЛКА НАЧАТА\n------------------------\n• {amount} {coin} надёжно заблокированы в эскроу Wayones.\n• Покупатель (@{buyer}): выполните оплату по инструкциям продавца до окончания таймера, затем нажмите «Я оплатил».\n• Продавец (@{seller}): НЕ освобождайте эскроу, пока не подтвердите поступление средств в своём аккаунте или выписке.\n• Безопасность: никогда не передавайте пароли и одноразовые коды; общайтесь по сделке только в Wayones.',
    completed: '@{seller} успешно продал {amount} {coin} пользователю @{buyer}.\n@{buyer} успешно купил {amount} {coin} у @{seller}.',
    cancelled: 'Сделка отменена. Не отправляйте и не оплачивайте средства по этой сделке. Если вы уже заплатили, не оставляйте ситуацию без внимания. Обратитесь в поддержку Wayones.',
    expired: '⚠️ СРОК СДЕЛКИ ИСТЁК (ВРЕМЯ ОПЛАТЫ ЗАКОНЧИЛОСЬ)\n----------------------------------------\nСделка истекла, поскольку время оплаты закончилось, а платёж не был подтверждён.\n• НЕ ОПЛАЧИВАЙТЕ: монеты больше не заблокированы в эскроу.\n• ЕСЛИ ВЫ УЖЕ ОПЛАТИЛИ: не платите повторно. Обратитесь в поддержку Wayones и предоставьте подтверждение оплаты.',
    disputeIntro: 'По этой сделке открыт спор.',
    disputeReason: 'Причина: {reason}',
    disputeOpenedBy: 'Спор открыт пользователем: @{opener}',
    disputeEvidence: 'Предоставьте запрошенные доказательства и документы в указанный срок. Храните все доказательства и переписку в Wayones. Никогда не передавайте пароли, одноразовые коды, приватные ключи или фразы восстановления.',
    disputeBuyerEvidence: 'Покупатель: загрузите подтверждение оплаты, например официальный чек, выписку или идентификатор транзакции.',
    disputeSellerEvidence: 'Продавец: загрузите соответствующую выписку или историю операций, чтобы показать, поступила ли оплата.',
    positiveFeedback: '@{opener} оставил положительный отзыв{comment}.',
    negativeFeedback: '@{opener} оставил отрицательный отзыв{comment}.',
    userBlocked: '@{opener} ({initiatorRole}) заблокировал @{blocked} ({targetRole}). Не отменяйте и не освобождайте сделку, если средства уже отправлены или получены.',
    issueReported: '@{opener} сообщил о проблеме.',
    issueCategory: 'Категория: {category}',
    issueDetails: 'Подробности: {details}',
    markedPaid: 'Покупатель @{buyer} отметил сделку как оплаченную. @{seller}, проверьте поступление средств на свой счёт до освобождения эскроу.',
    moderatorJoined: 'Модератор Wayones присоединился к чату сделки.',
    messageBlocked: 'Сообщение заблокировано: в целях безопасности внешнее общение и инструкции по сделке вне платформы запрещены в чате Wayones. Обсуждайте сделку только в Wayones.',
    securityReminder: 'Напоминание о безопасности Wayones: никогда не сообщайте пароль, код двухфакторной аутентификации, приватный ключ, seed-фразу или фразу восстановления. Поддержка Wayones никогда не попросит эти данные.',
  },
  vi: {
    badge: 'HỆ THỐNG Wayones', paymentMethodLabel: 'Phương thức thanh toán', systemTitle: 'Hệ thống Wayones',
    initiatedTitle: 'Đã bắt đầu giao dịch', completedTitle: 'Giao dịch hoàn tất',
    cancelledTitle: 'Giao dịch đã hủy', expiredTitle: 'Giao dịch hết hạn',
    disputedTitle: 'Thông báo tranh chấp chính thức', positiveFeedbackTitle: 'Đã nhận đánh giá tích cực',
    negativeFeedbackTitle: 'Đã nhận đánh giá tiêu cực', blockedTitle: 'Thông báo chặn người dùng',
    issueTitle: 'Đã báo cáo sự cố', paidTitle: 'Đã đánh dấu thanh toán',
    moderatorTitle: 'Điều hành viên Wayones', blockedMessageTitle: 'Cảnh báo bảo mật: Tin nhắn bị chặn',
    securityTitle: 'Nhắc nhở bảo mật Wayones',
    initiated: '🔒 ĐÃ BẮT ĐẦU GIAO DỊCH\n------------------------\n• {amount} {coin} đang được giữ an toàn trong ký quỹ Wayones.\n• Người mua (@{buyer}): hãy thanh toán theo hướng dẫn của người bán trước khi hết giờ, sau đó chọn “Tôi đã thanh toán”.\n• Người bán (@{seller}): KHÔNG giải ngân ký quỹ cho đến khi xác nhận tiền đã vào tài khoản hoặc sao kê của chính bạn.\n• Bảo mật: không bao giờ chia sẻ mật khẩu hoặc mã dùng một lần; hãy trao đổi về giao dịch trong Wayones.',
    completed: '@{seller} đã bán thành công {amount} {coin} cho @{buyer}.\n@{buyer} đã mua thành công {amount} {coin} từ @{seller}.',
    cancelled: 'Giao dịch đã bị hủy. Không gửi tiền hoặc thanh toán cho giao dịch này. Nếu bạn đã thanh toán, đừng bỏ mặc sự việc. Hãy liên hệ bộ phận hỗ trợ Wayones để được trợ giúp.',
    expired: '⚠️ GIAO DỊCH HẾT HẠN (ĐÃ HẾT THỜI GIAN THANH TOÁN)\n----------------------------------------\nGiao dịch hết hạn vì thời gian thanh toán kết thúc mà chưa xác nhận được khoản thanh toán.\n• KHÔNG THANH TOÁN: tài sản không còn được giữ trong ký quỹ.\n• NẾU BẠN ĐÃ THANH TOÁN: đừng thanh toán lần nữa. Hãy liên hệ hỗ trợ Wayones và cung cấp bằng chứng thanh toán.',
    disputeIntro: 'Giao dịch này hiện đang có tranh chấp.',
    disputeReason: 'Lý do: {reason}',
    disputeOpenedBy: 'Người mở tranh chấp: @{opener}',
    disputeEvidence: 'Vui lòng gửi bằng chứng và hồ sơ được yêu cầu trong thời hạn quy định. Giữ mọi bằng chứng và trao đổi trong Wayones. Không chia sẻ mật khẩu, mã dùng một lần, khóa riêng tư hoặc cụm từ khôi phục.',
    disputeBuyerEvidence: 'Người mua: tải lên bằng chứng thanh toán như biên lai chính thức, sao kê hoặc mã tham chiếu giao dịch.',
    disputeSellerEvidence: 'Người bán: tải lên sao kê tài khoản hoặc lịch sử giao dịch liên quan để xác nhận đã nhận được thanh toán hay chưa.',
    positiveFeedback: '@{opener} đã để lại đánh giá tích cực{comment}.',
    negativeFeedback: '@{opener} đã để lại đánh giá tiêu cực{comment}.',
    userBlocked: '@{opener} ({initiatorRole}) đã chặn @{blocked} ({targetRole}). Không hủy hoặc giải ngân giao dịch nếu tiền đã được gửi hoặc nhận.',
    issueReported: '@{opener} đã báo cáo sự cố.',
    issueCategory: 'Danh mục: {category}',
    issueDetails: 'Chi tiết: {details}',
    markedPaid: 'Người mua @{buyer} đã đánh dấu giao dịch là đã thanh toán. @{seller}, hãy xác minh tiền đã vào tài khoản nhận trước khi giải ngân ký quỹ.',
    moderatorJoined: 'Điều hành viên Wayones đã tham gia trò chuyện giao dịch.',
    messageBlocked: 'Tin nhắn đã bị chặn: để bảo vệ bạn, việc liên lạc bên ngoài nền tảng hoặc hướng dẫn giao dịch ngoài nền tảng không được phép trong Chat Giao dịch Wayones. Hãy giữ mọi trao đổi giao dịch trong Wayones.',
    securityReminder: 'Nhắc nhở bảo mật Wayones: không bao giờ chia sẻ mật khẩu, mã xác thực hai yếu tố, khóa riêng tư, cụm từ hạt giống hoặc cụm từ khôi phục. Bộ phận hỗ trợ Wayones sẽ không bao giờ yêu cầu bạn cung cấp các thông tin này.',
  },
  ar: {
    badge: 'نظام Wayones', paymentMethodLabel: 'طريقة الدفع', systemTitle: 'نظام Wayones',
    initiatedTitle: 'بدأت الصفقة', completedTitle: 'اكتملت الصفقة',
    cancelledTitle: 'أُلغيت الصفقة', expiredTitle: 'انتهت صلاحية الصفقة',
    disputedTitle: 'إشعار نزاع رسمي', positiveFeedbackTitle: 'تم استلام تقييم إيجابي',
    negativeFeedbackTitle: 'تم استلام تقييم سلبي', blockedTitle: 'إشعار حظر مستخدم',
    issueTitle: 'تم الإبلاغ عن مشكلة', paidTitle: 'تم تحديد الدفع',
    moderatorTitle: 'مشرف Wayones', blockedMessageTitle: 'تنبيه أمني: تم حظر الرسالة',
    securityTitle: 'تذكير أمني من Wayones',
    initiated: '🔒 بدأت الصفقة\n------------------------\n• يتم الاحتفاظ بمبلغ {amount} {coin} بأمان في ضمان Wayones.\n• المشتري (@{buyer}): أرسل الدفع وفق تعليمات البائع قبل انتهاء المؤقت، ثم اختر «لقد دفعت».\n• البائع (@{seller}): لا تحرر الضمان قبل التأكد من وصول الأموال في حسابك أو كشف حسابك الشخصي.\n• الأمان: لا تشارك كلمات المرور أو رموز الاستخدام لمرة واحدة، وأبقِ التواصل المتعلق بالصفقة داخل Wayones.',
    completed: 'باع @{seller} بنجاح {amount} {coin} إلى @{buyer}.\nاشترى @{buyer} بنجاح {amount} {coin} من @{seller}.',
    cancelled: 'تم إلغاء الصفقة. لا ترسل الأموال أو تدفع مقابل هذه الصفقة. إذا كنت قد دفعت بالفعل، فلا تترك الأمر دون متابعة. تواصل مع دعم Wayones للحصول على المساعدة.',
    expired: '⚠️ انتهت صلاحية الصفقة (انتهى وقت الدفع)\n----------------------------------------\nانتهت الصفقة لأن مؤقت الدفع انتهى دون تأكيد الدفع.\n• لا تقم بالدفع: لم تعد العملة محجوزة في الضمان.\n• إذا كنت قد دفعت بالفعل: لا تدفع مرة أخرى. تواصل مع دعم Wayones وقدّم إثبات الدفع.',
    disputeIntro: 'هذه الصفقة الآن قيد النزاع.',
    disputeReason: 'السبب: {reason}',
    disputeOpenedBy: 'فتح النزاع: @{opener}',
    disputeEvidence: 'يرجى تقديم الأدلة والسجلات المطلوبة خلال المهلة المحددة. احتفظ بجميع الأدلة والمراسلات داخل Wayones. لا تشارك كلمات المرور أو الرموز المؤقتة أو المفاتيح الخاصة أو عبارات الاسترداد.',
    disputeBuyerEvidence: 'المشتري: حمّل إثبات الدفع، مثل إيصال رسمي أو كشف حساب أو مرجع المعاملة.',
    disputeSellerEvidence: 'البائع: حمّل كشف الحساب أو سجل المعاملات ذي الصلة لتوضيح ما إذا كان الدفع قد وصل.',
    positiveFeedback: 'ترك @{opener} تقييماً إيجابياً{comment}.',
    negativeFeedback: 'ترك @{opener} تقييماً سلبياً{comment}.',
    userBlocked: 'حظر @{opener} ({initiatorRole}) المستخدم @{blocked} ({targetRole}). لا تلغِ الصفقة ولا تحرر الضمان إذا تم إرسال الأموال أو استلامها.',
    issueReported: 'أبلغ @{opener} عن مشكلة.',
    issueCategory: 'الفئة: {category}',
    issueDetails: 'التفاصيل: {details}',
    markedPaid: 'وضع المشتري @{buyer} علامة على أن الصفقة مدفوعة. @{seller}، تحقق من وصول الدفعة إلى حسابك قبل تحرير الضمان.',
    moderatorJoined: 'انضم مشرف Wayones إلى محادثة الصفقة.',
    messageBlocked: 'تم حظر الرسالة: حفاظاً على أمنك، لا يُسمح بالتواصل خارج المنصة أو بتعليمات التداول خارج دردشة Wayones. أبقِ جميع الاتصالات المتعلقة بالصفقة داخل Wayones.',
    securityReminder: 'تذكير أمني من Wayones: لا تشارك كلمة المرور أو رمز المصادقة الثنائية أو المفتاح الخاص أو العبارة الأولية أو عبارة الاسترداد مع أي شخص. لن يطلب منك دعم Wayones مطلقاً الكشف عن هذه البيانات.',
  },
  hi: {
    badge: 'Wayones सिस्टम', paymentMethodLabel: 'भुगतान का तरीका', systemTitle: 'Wayones सिस्टम',
    initiatedTitle: 'ट्रेड शुरू हुआ', completedTitle: 'ट्रेड पूरा हुआ',
    cancelledTitle: 'ट्रेड रद्द हुआ', expiredTitle: 'ट्रेड की समय-सीमा समाप्त',
    disputedTitle: 'आधिकारिक विवाद सूचना', positiveFeedbackTitle: 'सकारात्मक प्रतिक्रिया मिली',
    negativeFeedbackTitle: 'नकारात्मक प्रतिक्रिया मिली', blockedTitle: 'उपयोगकर्ता ब्लॉक सूचना',
    issueTitle: 'समस्या की रिपोर्ट', paidTitle: 'भुगतान चिह्नित किया गया',
    moderatorTitle: 'Wayones मॉडरेटर', blockedMessageTitle: 'सुरक्षा चेतावनी: संदेश ब्लॉक किया गया',
    securityTitle: 'Wayones सुरक्षा अनुस्मारक',
    initiated: '🔒 ट्रेड शुरू हुआ\n------------------------\n• {amount} {coin} को Wayones एस्क्रो में सुरक्षित रखा गया है।\n• खरीदार (@{buyer}): टाइमर समाप्त होने से पहले विक्रेता के निर्देशों के अनुसार भुगतान करें, फिर “मैंने भुगतान कर दिया” चुनें।\n• विक्रेता (@{seller}): अपने खाते या स्टेटमेंट में राशि प्राप्त होने की पुष्टि किए बिना एस्क्रो जारी न करें।\n• सुरक्षा: पासवर्ड या एक बार उपयोग होने वाले कोड कभी साझा न करें और ट्रेड की बातचीत Wayones के अंदर ही रखें।',
    completed: '@{seller} ने @{buyer} को {amount} {coin} सफलतापूर्वक बेचा।\n@{buyer} ने @{seller} से {amount} {coin} सफलतापूर्वक खरीदा।',
    cancelled: 'ट्रेड रद्द कर दिया गया है। इस ट्रेड के लिए पैसे न भेजें और न भुगतान करें। यदि आपने पहले ही भुगतान कर दिया है, तो मामले को अधूरा न छोड़ें। सहायता के लिए Wayones सपोर्ट से संपर्क करें।',
    expired: '⚠️ ट्रेड की समय-सीमा समाप्त (भुगतान का समय पूरा हुआ)\n----------------------------------------\nभुगतान की पुष्टि होने से पहले भुगतान टाइमर समाप्त होने के कारण यह ट्रेड समाप्त हो गया।\n• भुगतान न करें: कॉइन अब एस्क्रो में लॉक नहीं है।\n• यदि आपने पहले ही भुगतान किया है: दोबारा भुगतान न करें। भुगतान प्रमाण के साथ Wayones सपोर्ट से संपर्क करें।',
    disputeIntro: 'यह ट्रेड अब विवाद के अंतर्गत है।',
    disputeReason: 'कारण: {reason}',
    disputeOpenedBy: 'विवाद शुरू करने वाला: @{opener}',
    disputeEvidence: 'निर्धारित समय के भीतर मांगे गए प्रमाण और संबंधित रिकॉर्ड जमा करें। सभी प्रमाण और बातचीत Wayones के अंदर रखें। पासवर्ड, एक बार उपयोग होने वाले कोड, निजी कुंजी या रिकवरी वाक्यांश साझा न करें।',
    disputeBuyerEvidence: 'खरीदार: भुगतान का प्रमाण अपलोड करें, जैसे आधिकारिक रसीद, स्टेटमेंट या ट्रांज़ैक्शन संदर्भ संख्या।',
    disputeSellerEvidence: 'विक्रेता: संबंधित खाते का स्टेटमेंट या लेन-देन इतिहास अपलोड करें, जिससे भुगतान प्राप्त होने की स्थिति स्पष्ट हो।',
    positiveFeedback: '@{opener} ने सकारात्मक प्रतिक्रिया दी{comment}।',
    negativeFeedback: '@{opener} ने नकारात्मक प्रतिक्रिया दी{comment}।',
    userBlocked: '@{opener} ({initiatorRole}) ने @{blocked} ({targetRole}) को ब्लॉक किया। यदि धन भेजा या प्राप्त किया जा चुका है, तो ट्रेड रद्द या एस्क्रो जारी न करें।',
    issueReported: '@{opener} ने समस्या की रिपोर्ट की।',
    issueCategory: 'श्रेणी: {category}',
    issueDetails: 'विवरण: {details}',
    markedPaid: 'खरीदार @{buyer} ने ट्रेड को भुगतान किया हुआ चिह्नित किया है। @{seller}, एस्क्रो जारी करने से पहले अपने प्राप्तकर्ता खाते में भुगतान की पुष्टि करें।',
    moderatorJoined: 'Wayones मॉडरेटर ट्रेड चैट में शामिल हुआ।',
    messageBlocked: 'संदेश ब्लॉक किया गया: आपकी सुरक्षा के लिए Wayones ट्रेड चैट में प्लेटफ़ॉर्म से बाहर संपर्क या ट्रेड निर्देश की अनुमति नहीं है। ट्रेड से जुड़ी बातचीत Wayones के अंदर ही रखें।',
    securityReminder: 'Wayones सुरक्षा अनुस्मारक: अपना पासवर्ड, दो-कारक प्रमाणीकरण कोड, निजी कुंजी, सीड फ़्रेज़ या रिकवरी फ़्रेज़ किसी के साथ साझा न करें। Wayones सपोर्ट कभी भी ये जानकारी नहीं मांगेगा।',
  },
};

const titleKeyByType: Record<string, keyof TemplateSet> = {
  TRADE_INITIATED: 'initiatedTitle',
  TRADE_STARTED: 'initiatedTitle',
  ESCROW_LOCKED: 'initiatedTitle',
  TRADE_COMPLETED: 'completedTitle',
  TRADE_RELEASED: 'completedTitle',
  TRADE_CANCELLED: 'cancelledTitle',
  TRADE_EXPIRED: 'expiredTitle',
  TRADE_DISPUTED: 'disputedTitle',
  POSITIVE_FEEDBACK: 'positiveFeedbackTitle',
  NEGATIVE_FEEDBACK: 'negativeFeedbackTitle',
  USER_BLOCKED: 'blockedTitle',
  ISSUE_REPORTED: 'issueTitle',
  MARKED_PAID: 'paidTitle',
  MODERATOR_JOINED: 'moderatorTitle',
  MESSAGE_BLOCKED: 'blockedMessageTitle',
  SECURITY_REMINDER: 'securityTitle',
};

function clean(value: unknown, fallback = ''): string {
  if (value === null || value === undefined) return fallback;
  return String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').slice(0, 6000);
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{([a-zA-Z]+)\}/g, (_match, key: string) => values[key] ?? '');
}

function roleLabel(value: unknown, lang: string): string {
  const role = clean(value, 'Trader').toLowerCase();
  const roles: Record<string, Record<string, string>> = {
    'zh-CN': { buyer: '买家', seller: '卖家', trader: '交易者' },
    'zh-TW': { buyer: '買家', seller: '賣家', trader: '交易者' },
    'pt-BR': { buyer: 'Comprador', seller: 'Vendedor', trader: 'Usuário' },
    ko: { buyer: '구매자', seller: '판매자', trader: '사용자' },
    fr: { buyer: 'Acheteur', seller: 'Vendeur', trader: 'Utilisateur' },
    es: { buyer: 'Comprador', seller: 'Vendedor', trader: 'Usuario' },
    ru: { buyer: 'Покупатель', seller: 'Продавец', trader: 'Пользователь' },
    vi: { buyer: 'Người mua', seller: 'Người bán', trader: 'Người dùng' },
    ar: { buyer: 'المشتري', seller: 'البائع', trader: 'مستخدم' },
    hi: { buyer: 'खरीदार', seller: 'विक्रेता', trader: 'उपयोगकर्ता' },
  };
  return roles[lang]?.[role] || (role === 'buyer' ? 'Buyer' : role === 'seller' ? 'Seller' : 'Trader');
}

export function getTradeSystemMessageTitle(type: string | undefined, language: string): string | null {
  if (!type) return null;
  const locale = messages[language] || messages.en;
  const normalizedType = type.toUpperCase();
  const key = titleKeyByType[normalizedType];
  if (key) return locale[key];
  return normalizedType === 'CUSTOM' ? locale.systemTitle : null;
}

export function getTradeSystemMessageBadge(language: string): string {
  return (messages[language] || messages.en).badge;
}

export function formatLocalizedTradeSystemMessage(
  type: string | undefined,
  metadata: Record<string, unknown> | null | undefined,
  language: string,
  fallbackMessage = '',
): string | null {
  if (!type) return null;
  const normalizedType = type.toUpperCase();
  const locale = messages[language] || messages.en;
  const data = metadata || {};
  const coin = clean(data.coinSymbol, 'USDT').toUpperCase();
  const amountValue = data.coinAmount;
  const amount = formatCryptoAmount(
    typeof amountValue === 'number' || typeof amountValue === 'string' ? amountValue : '0.00',
    coin,
  );
  const values = {
    amount,
    coin,
    buyer: clean(data.buyerUsername, 'Buyer'),
    seller: clean(data.sellerUsername, 'Seller'),
    opener: clean(data.openerUsername, 'Trader'),
    blocked: clean(data.blockedUsername, 'User'),
    initiatorRole: roleLabel(data.initiatorRole, language),
    targetRole: roleLabel(data.targetRole, language),
    reason: clean(data.disputeReason || data.reason, 'Payment issue'),
    paymentMethod: clean(data.paymentMethod, 'selected payment method'),
    category: clean(data.issueCategory, ''),
    details: clean(data.issueDetails, ''),
    comment: clean(data.feedbackComment || data.customText, ''),
  };

  switch (normalizedType) {
    case 'TRADE_INITIATED':
    case 'TRADE_STARTED':
    case 'ESCROW_LOCKED':
      return fill(locale.initiated, values);
    case 'TRADE_COMPLETED':
    case 'TRADE_RELEASED':
      return fill(locale.completed, values);
    case 'TRADE_CANCELLED':
      return locale.cancelled;
    case 'TRADE_EXPIRED':
      return locale.expired;
    case 'TRADE_DISPUTED':
      // Keep the existing English method-specific evidence instructions verbatim
      // for English users; other locales receive the reviewed localized guidance.
      if (language === 'en' && fallbackMessage) return fallbackMessage;
      return [
        locale.disputeIntro,
        fill(locale.disputeReason, values),
        fill(locale.disputeOpenedBy, values),
        '',
        locale.disputeEvidence,
        fill(locale.disputeBuyerEvidence, values),
        fill(locale.disputeSellerEvidence, values),
        `${locale.paymentMethodLabel}: ${values.paymentMethod}`,
      ].join('\n');
    case 'POSITIVE_FEEDBACK':
      return fill(locale.positiveFeedback, { ...values, comment: values.comment ? ` "${values.comment}"` : '' });
    case 'NEGATIVE_FEEDBACK':
      return fill(locale.negativeFeedback, { ...values, comment: values.comment ? ` "${values.comment}"` : '' });
    case 'USER_BLOCKED':
      return fill(locale.userBlocked, values);
    case 'ISSUE_REPORTED':
      return [
        fill(locale.issueReported, values),
        values.category ? fill(locale.issueCategory, values) : '',
        fill(locale.issueDetails, values),
      ].filter(Boolean).join('\n');
    case 'MARKED_PAID':
      return fill(locale.markedPaid, values);
    case 'MODERATOR_JOINED':
      return locale.moderatorJoined;
    case 'MESSAGE_BLOCKED':
      return locale.messageBlocked;
    case 'SECURITY_REMINDER':
      return locale.securityReminder;
    case 'CUSTOM':
      return typeof data.customText === 'string' ? data.customText : (fallbackMessage || null);
    default:
      return fallbackMessage || null;
  }
}
