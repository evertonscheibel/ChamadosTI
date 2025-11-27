import React from 'react';
import { useApp } from '../context/AppContext';
import { Download, FileText, File, ReceiptText } from 'lucide-react'; // Added ReceiptText icon
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Bill, BillStatus } from '../types'; // Import Bill and BillStatus

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

// Determine delivery status for reporting/display
const getDeliveryStatus = (bill: Bill): 'Pendente' | 'Entrega Urgente' | 'Atrasado para Entrega' | 'Entregue' => {
  if (bill.status === BillStatus.PAID) return 'Entregue';
  
  const deliverByDate = calculateDeliverByDate(bill.dueDate);
  const daysUntilDeliveryDue = getDaysUntil(deliverByDate);

  if (daysUntilDeliveryDue < 0) return 'Atrasado para Entrega';
  if (daysUntilDeliveryDue <= 7) return 'Entrega Urgente'; // 7 days or less
  return 'Pendente';
};

export const Reports: React.FC = () => {
  const { tickets, assets, certificates, bills } = useApp();

  const generateCSV = (data: any[], filename: string) => {
    if (!data.length) return;
    const headers = Object.keys(data[0]).join(',');
    const rows = data.map(obj => Object.values(obj).map(v => 
        typeof v === 'object' ? JSON.stringify(v).replace(/"/g, '""') : `"${v}"`
    ).join(',')).join('\n');
    const csvContent = `data:text/csv;charset=utf-8,${headers}\n${rows}`;
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const generatePDF = (title: string, data: any[], filename: string, columnStyles?: any) => {
      if(!data.length) return;
      const doc = new jsPDF();
      
      // Title
      doc.setFontSize(18);
      doc.text(title, 14, 22);
      doc.setFontSize(11);
      doc.setTextColor(100);
      doc.text(`Gerado em: ${new Date().toLocaleDateString()}`, 14, 30);

      const head = [Object.keys(data[0])];
      const body = data.map(obj => Object.values(obj).map(v => 
          typeof v === 'object' ? JSON.stringify(v) : String(v)
      ));

      autoTable(doc, {
          head: head,
          body: body,
          startY: 40,
          styles: { fontSize: 8 },
          headStyles: { fillColor: [41, 128, 185] },
          columnStyles: columnStyles || {}
      });

      doc.save(filename);
  };

  // Prepare data for the new Bills Delivery Report
  const billsDeliveryReportData = bills.map(bill => ({
    id: bill.id,
    description: bill.description,
    supplier: bill.supplier,
    value: `R$ ${bill.value.toFixed(2)}`,
    dueDate: bill.dueDate,
    deliverByDate: calculateDeliverByDate(bill.dueDate),
    deliveryStatus: getDeliveryStatus(bill),
    billStatus: bill.status,
    notes: bill.notes || '-',
  }));

  const billsDeliveryColumnStyles = {
    4: { cellWidth: 20 }, // Deliver By Date
    5: { cellWidth: 25 }, // Delivery Status
    // Add more column styles if needed
  };


  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Relatórios do Sistema</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Ticket Report Card */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
          <div className="p-3 bg-blue-100 rounded-lg w-fit mb-4">
            <FileText className="w-6 h-6 text-blue-600" />
          </div>
          <h3 className="text-lg font-bold text-slate-900">Performance de Chamados</h3>
          <p className="text-sm text-slate-500 mt-2 mb-6">
            Detalhamento do tempo de resolução, categorias e performance dos técnicos.
          </p>
          <div className="flex gap-2">
            <button 
                onClick={() => generateCSV(tickets, 'chamados_report.csv')}
                className="flex-1 flex items-center justify-center gap-2 border border-slate-300 rounded-lg py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
                <File className="w-4 h-4" /> CSV
            </button>
            <button 
                onClick={() => generatePDF('Relatório de Chamados', tickets, 'chamados_report.pdf')}
                className="flex-1 flex items-center justify-center gap-2 bg-slate-800 rounded-lg py-2 text-sm font-medium text-white hover:bg-slate-700"
            >
                <Download className="w-4 h-4" /> PDF
            </button>
          </div>
        </div>

        {/* Asset Report Card */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
          <div className="p-3 bg-green-100 rounded-lg w-fit mb-4">
            <FileText className="w-6 h-6 text-green-600" />
          </div>
          <h3 className="text-lg font-bold text-slate-900">Inventário de Ativos</h3>
          <p className="text-sm text-slate-500 mt-2 mb-6">
            Lista completa de hardware e software ativos, incluindo localização e status de manutenção.
          </p>
          <div className="flex gap-2">
             <button 
                onClick={() => generateCSV(assets, 'ativos_report.csv')}
                className="flex-1 flex items-center justify-center gap-2 border border-slate-300 rounded-lg py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
             >
                <File className="w-4 h-4" /> CSV
             </button>
             <button 
                onClick={() => generatePDF('Inventário de Ativos', assets, 'ativos_report.pdf')}
                className="flex-1 flex items-center justify-center gap-2 bg-slate-800 rounded-lg py-2 text-sm font-medium text-white hover:bg-slate-700"
             >
                <Download className="w-4 h-4" /> PDF
            </button>
          </div>
        </div>

        {/* Certificate Report Card */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
          <div className="p-3 bg-amber-100 rounded-lg w-fit mb-4">
            <FileText className="w-6 h-6 text-amber-600" />
          </div>
          <h3 className="text-lg font-bold text-slate-900">Status de Certificados</h3>
          <p className="text-sm text-slate-500 mt-2 mb-6">
            Relatório de conformidade para SSLs, garantias e licenças com projeções de expiração.
          </p>
          <div className="flex gap-2">
             <button 
                onClick={() => generateCSV(certificates, 'certificados_report.csv')}
                className="flex-1 flex items-center justify-center gap-2 border border-slate-300 rounded-lg py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
             >
                <File className="w-4 h-4" /> CSV
             </button>
             <button 
                onClick={() => generatePDF('Relatório de Certificados', certificates, 'certificados_report.pdf')}
                className="flex-1 flex items-center justify-center gap-2 bg-slate-800 rounded-lg py-2 text-sm font-medium text-white hover:bg-slate-700"
             >
                <Download className="w-4 h-4" /> PDF
            </button>
          </div>
        </div>

        {/* New Bills Delivery Report Card */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
          <div className="p-3 bg-purple-100 rounded-lg w-fit mb-4">
            <ReceiptText className="w-6 h-6 text-purple-600" />
          </div>
          <h3 className="text-lg font-bold text-slate-900">Controle de Entrega de Boletos</h3>
          <p className="text-sm text-slate-500 mt-2 mb-6">
            Acompanhe o status de entrega e os prazos limite para pagamento de boletos.
          </p>
          <div className="flex gap-2">
             <button 
                onClick={() => generateCSV(billsDeliveryReportData, 'boletos_entrega_report.csv')}
                className="flex-1 flex items-center justify-center gap-2 border border-slate-300 rounded-lg py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
             >
                <File className="w-4 h-4" /> CSV
             </button>
             <button 
                onClick={() => generatePDF('Controle de Entrega de Boletos', billsDeliveryReportData, 'boletos_entrega_report.pdf', billsDeliveryColumnStyles)}
                className="flex-1 flex items-center justify-center gap-2 bg-slate-800 rounded-lg py-2 text-sm font-medium text-white hover:bg-slate-700"
             >
                <Download className="w-4 h-4" /> PDF
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};