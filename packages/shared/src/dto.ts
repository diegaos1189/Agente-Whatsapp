import type {
  ConversationStatus,
  DeliveryType,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from "./enums.js";

export interface ProductDTO {
  id: string;
  categoryId: string;
  categoryName: string;
  name: string;
  description: string | null;
  price: number;
  isAvailable: boolean;
  sortOrder: number;
  isDefaultVariant: boolean;
  searchKeywords: string | null;
  unitCount: number | null;
  isCombo: boolean;
  comboItems: ComboItemDTO[];
  showInMenu: boolean;
}

export interface ComboItemDTO {
  productId: string;
  productName: string;
  quantity: number;
}

export interface CategoryDTO {
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  parentCategoryId: string | null;
  products: ProductDTO[];
}

export interface PromotionDTO {
  id: string;
  title: string;
  description: string;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  productId: string | null;
  productName: string | null;
  productPrice: number | null;
  discountType: "PERCENTAGE" | "FIXED_AMOUNT" | null;
  discountValue: number | null;
  /** Dias de la semana en que aplica: 0=domingo...6=sabado (Date.getDay()). Vacio = todos los dias. */
  daysOfWeek: number[];
}

export interface ProductRecommendationDTO {
  id: string;
  sourceProductId: string | null;
  sourceProductName: string | null;
  sourceCategoryId: string | null;
  sourceCategoryName: string | null;
  recommendedProductId: string;
  recommendedProductName: string;
  recommendationType: "UPSELL" | "CROSS_SELL" | "ADD_ON";
  priority: number;
  active: boolean;
}

export interface FaqDTO {
  id: string;
  question: string;
  answer: string;
  isActive: boolean;
}

export interface OrderItemDTO {
  id: string;
  /** Null si el producto fue borrado del catalogo despues del pedido — productName conserva el nombre igual. */
  productId: string | null;
  productName: string;
  quantity: number;
  unitPrice: number;
  notes: string | null;
}

export interface OrderDTO {
  id: string;
  code: string;
  contactId: string;
  customerName: string | null;
  phone: string;
  status: OrderStatus;
  deliveryType: DeliveryType;
  paymentMethod: PaymentMethod | null;
  paymentStatus: PaymentStatus;
  paidAmount?: number;
  refundedAmount?: number;
  netPaidAmount?: number;
  outstandingAmount?: number;
  total: number;
  deliveryFee: number;
  address: string | null;
  neighborhood: string | null;
  reference: string | null;
  contactPhone: string | null;
  flaggedForReview: boolean;
  flagNote: string | null;
  /** Minutos desde que se creo el pedido hasta que se marco DELIVERED. Null si aun no se entrega. */
  dispatchMinutes: number | null;
  items: OrderItemDTO[];
  createdAt: string;
  updatedAt: string;
}

export interface PaymentDTO {
  id: string;
  orderId: string;
  method: string;
  provider: string;
  status: PaymentStatus;
  amount: number;
  currency: string;
  paidAmount: number;
  refundedAmount: number;
  netPaidAmount: number;
  idempotencyKey: string | null;
  checkoutVersion: number | null;
  providerPaymentId: string | null;
  providerReference: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  paymentUrl: string | null;
  expiresAt: string | null;
  authorizedAt: string | null;
  paidAt: string | null;
  failedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentRefundDTO {
  id: string;
  paymentId: string;
  amount: number;
  currency: string;
  status: string;
  reasonCode: string | null;
  idempotencyKey: string | null;
  providerRefundId: string | null;
  requestedBy: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface PaymentReconciliationIssueDTO {
  id: string;
  paymentId: string | null;
  issueType: string;
  severity: string;
  expectedAmount: number | null;
  providerAmount: number | null;
  expectedCurrency: string | null;
  providerCurrency: string | null;
  providerReference: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface PendingOrderCartItemDTO {
  itemId?: string;
  productId: string | null;
  productName: string;
  quantity: number;
  unitPrice: number;
  notes?: string | null;
  components?: Array<{
    componentId: string;
    productId: string | null;
    productName: string;
    categoryName: string | null;
    quantity: number;
    unitPrice: number;
    source: "INCLUDED" | "ADDED";
    status: "ACTIVE" | "REMOVED";
  }>;
}

/** Lo que la IA ya recopilo del pedido a mitad de conversacion (antes de confirmarlo) —
 * util para que un humano en handoff no tenga que empezar de cero. */
export interface PendingOrderDTO {
  cart: PendingOrderCartItemDTO[];
  deliveryType: "DELIVERY" | "PICKUP" | null;
  address: string | null;
  neighborhood: string | null;
  paymentMethod: "CASH" | "TRANSFER" | "CARD_ON_DELIVERY" | null;
}

export interface ConversationDetailDTO {
  id: string;
  contactId: string;
  customerName: string | null;
  phone: string;
  status: ConversationStatus;
  isHandoff: boolean;
  handoffReason: string | null;
  assignedAdminUserId: string | null;
  assignedAdminUsername: string | null;
  takenAt: string | null;
  pendingOrder: PendingOrderDTO | null;
}

export interface ConversationSummaryDTO {
  id: string;
  contactId: string;
  customerName: string | null;
  phone: string;
  status: ConversationStatus;
  isHandoff: boolean;
  handoffReason: string | null;
  assignedAdminUserId: string | null;
  assignedAdminUsername: string | null;
  takenAt: string | null;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  createdAt: string;
}

export interface MessageDTO {
  id: string;
  conversationId: string;
  direction: "INBOUND" | "OUTBOUND";
  type: string;
  senderType: "CUSTOMER" | "BOT" | "HUMAN" | "SYSTEM" | null;
  adminUserId: string | null;
  adminUsername: string | null;
  body: string;
  mediaUrl: string | null;
  createdAt: string;
}

export interface TransferAccountDTO {
  bankName: string;
  accountInfo: string;
  qrImage: string | null;
}

export interface ProductSalesMetricDTO {
  productName: string;
  quantity: number;
  revenue: number;
}

export interface PeakHourMetricDTO {
  hour: number;
  orderCount: number;
}

export interface MixMetricDTO {
  key: string;
  label: string;
  count: number;
  revenue: number;
}

export interface CustomerSegmentMetricDTO {
  key: string;
  label: string;
  count: number;
  description: string;
}

export interface CustomerSegmentCustomerDTO {
  contactId: string;
  customerName: string | null;
  phone: string;
  lastOrderAt: string;
  daysSinceLastOrder: number;
  totalOrders: number;
  ordersLast30Days: number;
  ordersLast90Days: number;
  avgDaysBetweenOrders: number | null;
}

export interface CustomerSegmentCustomersDTO {
  recent: CustomerSegmentCustomerDTO[];
  frequent: CustomerSegmentCustomerDTO[];
  dormant: CustomerSegmentCustomerDTO[];
}

export interface MetricsDTO {
  ordersToday: number;
  ordersLast7Days: number;
  ordersLast30Days: number;
  revenueToday: number;
  revenueThisMonth: number;
  avgTicket: number;
  avgPrepMinutes: number | null;
  /** Promedio de minutos desde que se crea el pedido hasta que se marca DELIVERED (solo pedidos a domicilio). */
  avgDeliveryMinutesToday: number | null;
  avgDeliveryMinutesThisMonth: number | null;
  estimatedPrepMinutes: number;
  currency: string;
  totalConversations30Days: number;
  handoffRate: number;
  ordersByStatus: Record<string, number>;
  riskOrdersOpen: number;
  proactiveAlertsLast30Days: number;
  riskByType: Record<string, number>;
  paymentConfirmationSlaMinutes: number | null;
  paymentConfirmationSampleCount: number;
  kitchenSlaMinutes: number | null;
  kitchenSampleCount: number;
  dispatchSlaMinutes: number | null;
  dispatchSampleCount: number;
  deliveryLegSlaMinutes: number | null;
  deliveryLegSampleCount: number;
  topSellingProducts: ProductSalesMetricDTO[];
  peakOrderHours: PeakHourMetricDTO[];
  paymentMethodMix: MixMetricDTO[];
  deliveryTypeMix: MixMetricDTO[];
  conversationToOrderConversionRate: number;
  convertedConversations30Days: number;
  customerSegments: CustomerSegmentMetricDTO[];
  repeatCustomers30Days: number;
  repeatPurchaseRate30Days: number;
  avgDaysBetweenOrders: number | null;
}

export interface OrderOperationalAlertDTO {
  orderId: string;
  orderCode: string;
  customerName: string | null;
  phone: string;
  status: OrderStatus;
  deliveryType: DeliveryType;
  reason:
    | "AWAITING_PAYMENT_STALE"
    | "RECEIVED_STALE"
    | "READY_FOR_PICKUP_STALE"
    | "READY_FOR_DISPATCH_STALE";
  note: string;
  delayMinutes: number;
  suggestedAction: string;
  createdAt: string;
  updatedAt: string;
}

export interface RangeMetricsDTO {
  from: string;
  to: string;
  orderCount: number;
  revenue: number;
  avgTicket: number;
  currency: string;
}

export interface BusinessSettingsDTO {
  id: string;
  /**
   * Restaurante dueño de esta configuracion. Va en el DTO a proposito: el objeto `settings`
   * ya viaja por todo el flujo del bot, asi que llevar el restaurante adentro es lo que
   * permite que cada paso (catalogo, promociones, envio por WhatsApp) sepa a quien atiende
   * sin pasar el id a mano por cada firma.
   */
  restaurantId: string;
  restaurantName: string;
  logoUrl: string | null;
  menuImages: string[];
  phone: string;
  address: string;
  currency: string;
  timezone: string;
  openingHours: Record<string, { open: string; close: string } | null>;
  deliveryFee: number;
  acceptsDelivery: boolean;
  acceptsPickup: boolean;
  minimumDeliveryOrder: number;
  deliveryCoverageKeywords: string[];
  estimatedPrepMinutes: number;
  acceptsScheduledOrders: boolean;
  acceptedPaymentMethods: string[];
  transferAccounts: TransferAccountDTO[];
  outOfHoursMessage: string;
  welcomeMessage: string;
  assistantTone: string;
  agentName: string;
  dailyArchiveTime: string;
  cartRecoveryEnabled: boolean;
  cartRecoveryDelayMinutes: number;
  cartRecoveryMaxAttempts: number;
  cartRecoveryMessage: string;
  upsellEnabled: boolean;
  maxUpsellOffers: number;
  whatsappProvider: string;
  whatsappPhoneNumberId: string;
  whatsappToken: string;
  whatsappAppSecret: string;
  whatsappVerifyToken: string;
  whatsappApiVersion: string;
  reactivationEnabled: boolean;
  reactivationTemplateName: string;
  reactivationTemplateLanguage: string;
  reactivationDormantDays: number;
  reactivationCooldownDays: number;
}

export interface AdminUserDTO {
  id: string;
  username: string;
  role: string;
  permissions: string[];
  createdAt: string;
}
