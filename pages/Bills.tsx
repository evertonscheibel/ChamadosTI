import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { Bill, BillStatus } from '../types';
import { Plus, X, ReceiptText, CalendarDays, CheckCircle2, AlertOctagon, BellRing } from 'lucide-react';

// Helper function to calculate 'Entregar até' date (dueDate - 7 days)
const calculateDeliverByDate = (dueDateString: string): string => {
  const dueDate = new Date(dueDateString + 'T00:00:00'); // Ensure UTC for consistent calculation
  dueDate.setDate(dueDate.getDate() - 7);
  return dueDate.toISOString().split('T')[0];
};

// Helper function to get days until a specific date
const getDaysUntil = (dateString: string): number => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const targetDate = new Date(dateString + 'T00:00:00'); // Ensure UTC for consistent calculation
  targetDate.setHours(0, 0, 0, 0);
  const diffTime = targetDate.getTime() - today.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

export const Bills: React.FC = () => {
  const { bills, addBill, updateBill } = useApp();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingBill, setEditingBill] = useState<Bill | null>(null);
  const [showAlert, setShowAlert] = useState(false);
  const [alertMessage, setAlertMessage] = useState('');

  const [formData, setFormData] = useState<Partial<Bill>>({
    description: '',
    value: 0,
    dueDate: '',
    status: BillStatus.OPEN,
    supplier: '',
    notes: '', // New notes field
  });

  // Calculate status for display
  const getBillStatus = (bill: Bill): BillStatus => {
    if (bill.status === BillStatus.PAID) return BillStatus.PAID;
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Normalize today to start of day
    const dueDate = new Date(bill.dueDate + 'T00:00:00'); // Ensure UTC for consistent calculation
    dueDate.setHours(0, 0, 0, 0); // Normalize due date to start of day

    if (dueDate < today) {
      return BillStatus.OVERDUE;
    }
    return BillStatus.OPEN;
  };

  // Determine delivery status for reporting/display
  const getDeliveryStatus = (bill: Bill): 'Pendente' | 'Entrega Urgente' | 'Atrasado para Entrega' | 'Entregue' => {
    if (bill.status === BillStatus.PAID) return 'Entregue';
    
    const deliverByDate = calculateDeliverByDate(bill.dueDate);
    const daysUntilDeliveryDue = getDaysUntil(deliverByDate);

    if (daysUntilDeliveryDue < 0) return 'Atrasado para Entrega';
    if (daysUntilDeliveryDue <= 7) return 'Entrega Urgente'; // 7 days or less
    return 'Pendente';
  };

  useEffect(() => {
    const urgentBills = bills.filter(bill => {
      if (bill.status === BillStatus.PAID) return false;
      const deliverByDate = calculateDeliverByDate(bill.dueDate);
      const daysUntilDelivery = getDaysUntil(deliverByDate);
      return daysUntilDelivery <= 2; // Alert 2 days before or if overdue
    });

    if (urgentBills.length > 0) {
      const message = urgentBills.length === 1
        ? `Atenção: O boleto "${urgentBills[0].description}" tem prazo de entrega para vencer em breve (${calculateDeliverByDate(urgentBills[0].dueDate)}).`
        : `Atenção: ${urgentBills.length} boletos têm prazo de entrega para vencer em breve.`;
      setAlertMessage(message);
      setShowAlert(true);
    } else {
      setShowAlert(false);
    }
  }, [bills]);

  const handleOpenModal = (bill?: Bill) => {
    if (bill) {
      setEditingBill(bill);
      setFormData(bill);
    } else {
      setEditingBill(null);
      setFormData({
        description: '',
        value: 0,
        dueDate: new Date().toISOString().split('T')[0],
        status: BillStatus.OPEN,
        supplier: '',
        notes: '',
      });
    }
    setIsModalOpen(true);
  };

  const handleSave = () => {
    if (!formData.description || !formData.value || !formData.dueDate || !formData.supplier) {
      alert('Por favor, preencha todos os campos obrigatórios.');
      return;
    }

    if (editingBill) {
      const updatedBill = { ...editingBill, ...formData } as Bill;
      // Recalculate status if it's not explicitly paid and due date changes
      if (updatedBill.status !== BillStatus.PAID) {
        updatedBill.status = getBillStatus(updatedBill);
      }
      updateBill(updatedBill);
    } else {
      const newBill: Bill = {
        id: `b${Date.now()}`,
        description: formData.description || '',
        value: formData.value || 0,
        dueDate: formData.dueDate || '',
        supplier: formData.supplier || '',
        status: getBillStatus(formData as Bill),
        notes: formData.notes || '',
      };
      addBill(newBill);
    }
    setIsModalOpen(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-slate-900">Controle de Boletos a Pagar</h1>
        <button
          onClick={() => handleOpenModal()}
          className="bg-purple-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-purple-700 flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> Novo Boleto
        </button>
      </div>

      {showAlert && (
        <div className="bg-amber-100 border border-amber-200 text-amber-800 px-4 py-3 rounded-lg flex items-center gap-3 animate-fade-in">
          <BellRing className="w-5 h-5" />
          <p className="text-sm font-medium">{alertMessage}</p>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-left text-sm text-slate-600">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-6 py-4 font-semibold text-slate-900">Descrição</th>
              <th className="px-6 py-4 font-semibold text-slate-900">Fornecedor</th>
              <th className="px-6 py-4 font-semibold text-slate-900">Valor</th>
              <th className="px-6 py-4 font-semibold text-slate-900">Vencimento</th>
              <th className="px-6 py-4 font-semibold text-slate-900">Entregar até</th> {/* New column */}
              <th className="px-6 py-4 font-semibold text-slate-900">Status</th>
              <th className="px-6 py-4 font-semibold text-slate-900">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {bills.map((bill) => {
              const currentStatus = getBillStatus(bill);
              const deliverByDate = calculateDeliverByDate(bill.dueDate);
              const daysUntilDeliveryDue = getDaysUntil(deliverByDate);

              let statusColorClass = '';
              let statusIcon: React.ReactNode = null;
              let rowHighlightClass = '';

              switch (currentStatus) {
                case BillStatus.PAID:
                  statusColorClass = 'bg-green-100 text-green-800';
                  statusIcon = <CheckCircle2 className="w-3 h-3" />;
                  break;
                case BillStatus.OVERDUE:
                  statusColorClass = 'bg-red-100 text-red-800';
                  statusIcon = <AlertOctagon className="w-3 h-3" />;
                  rowHighlightClass = 'bg-red-50'; // Highlight if bill is overdue
                  break;
                case BillStatus.OPEN:
                default:
                  statusColorClass = 'bg-blue-100 text-blue-800';
                  statusIcon = <ReceiptText className="w-3 h-3" />;
                  // Highlight based on delivery urgency
                  if (daysUntilDeliveryDue < 0) {
                    rowHighlightClass = 'bg-red-50'; // Delivery overdue
                  } else if (daysUntilDeliveryDue <= 7) {
                    rowHighlightClass = 'bg-amber-50'; // Delivery urgent
                  }
                  break;
              }

              return (
                <tr key={bill.id} className={`hover:bg-slate-50 ${rowHighlightClass}`}>
                  <td className="px-6 py-4 font-medium text-slate-900">{bill.description}</td>
                  <td className="px-6 py-4">{bill.supplier}</td>
                  <td className="px-6 py-4">R$ {bill.value.toFixed(2)}</td>
                  <td className="px-6 py-4">{bill.dueDate}</td>
                  <td className={`px-6 py-4 ${daysUntilDeliveryDue < 0 ? 'text-red-600 font-bold' : daysUntilDeliveryDue <= 7 ? 'text-amber-600 font-bold' : ''}`}>
                    {deliverByDate}
                  </td> {/* New column data */}
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${statusColorClass}`}>
                      {statusIcon} {currentStatus}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <button
                      onClick={() => handleOpenModal(bill)}
                      className="text-blue-600 hover:underline font-medium"
                    >
                      Editar
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Add/Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-md p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-slate-900">{editingBill ? 'Editar Boleto' : 'Novo Boleto'}</h2>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Descrição</label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="bg-white text-slate-900 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Fornecedor</label>
                <input
                  type="text"
                  value={formData.supplier}
                  onChange={(e) => setFormData({ ...formData, supplier: e.target.value })}
                  className="bg-white text-slate-900 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Valor</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.value}
                  onChange={(e) => setFormData({ ...formData, value: parseFloat(e.target.value) })}
                  className="bg-white text-slate-900 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Data de Vencimento</label>
                <input
                  type="date"
                  value={formData.dueDate}
                  onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
                  className="bg-white text-slate-900 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value as BillStatus })}
                  className="bg-white text-slate-900 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  {Object.values(BillStatus).map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Observação</label>
                <textarea
                  rows={3}
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  className="bg-white text-slate-900 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                  placeholder="Informações adicionais sobre o boleto..."
                ></textarea>
              </div>

              <button
                onClick={handleSave}
                className="w-full bg-purple-600 text-white py-2 rounded-lg font-medium hover:bg-purple-700 mt-2"
              >
                Salvar Boleto
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};