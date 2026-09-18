const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static(__dirname));

const URL_BANCO = process.env.MONGODB_URI || "mongodb+srv://admin:141607Skskiwkw@cluster0.iybvsjs.mongodb.net/sistema_bronze?appName=Cluster0";

mongoose.connect(URL_BANCO)
    .then(() => console.log("Conectado ao MongoDB na Nuvem com sucesso!"))
    .catch(err => console.error("Erro ao conectar no MongoDB:", err));

// Esquemas do Banco de Dados
const AgendamentoSchema = new mongoose.Schema({
    nome: String,
    telefone: String,
    tipo: String,
    data: String,
    hora: String,
    valor: String,
    oculos: Boolean
});

const PromocaoSchema = new mongoose.Schema({
    titulo: String,
    foto: String,
    preco: String,
    diasNum: [String],
    dias: [String],
    horaFixa: String
});

const ConfigSchema = new mongoose.Schema({
    senhaAdmin: { type: String, default: "141607" }
});

const Agendamento = mongoose.model('Agendamento', AgendamentoSchema);
const Promocao = mongoose.model('Promocao', PromocaoSchema);
const Config = mongoose.model('Config', ConfigSchema);

async function obterSenha() {
    let config = await Config.findOne();
    if (!config) {
        config = await Config.create({ senhaAdmin: "141607" });
    }
    return config.senhaAdmin;
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Salvar agendamento
app.post('/salvar', async (req, res) => {
    try {
        const { data, hora, tipo } = req.body;
        
        // Aplica limite apenas para Paredão (4) e Máquina Turbo (2). Sol é Ordem de Chegada (sem limite).
        if (tipo === 'Paredão' || tipo === 'Máquina Turbo') {
            const limiteMaximo = (tipo === 'Paredão') ? 4 : 2;
            const totalNoHorario = await Agendamento.countDocuments({ data, hora, tipo });

            if (totalNoHorario >= limiteMaximo) {
                return res.status(400).json({ 
                    erro: `O serviço "${tipo}" no horário ${hora} já atingiu o limite máximo de ${limiteMaximo} pessoas!` 
                });
            }
        }

        await Agendamento.create(req.body);
        res.status(201).send("Agendamento salvo!");
    } catch (e) {
        res.status(500).json({ erro: "Erro ao salvar agendamento" });
    }
});

// Listar agendamentos
app.get('/listar', async (req, res) => {
    const senhaRecebida = req.headers['codigo-secreto'];
    const senhaAtual = await obterSenha();

    if (senhaRecebida === senhaAtual) {
        const agendamentos = await Agendamento.find();
        res.json({ agendamentos });
    } else {
        res.status(401).send("Acesso negado");
    }
});

// Criar promoção
app.post('/promocoes', async (req, res) => {
    const senhaRecebida = req.headers['codigo-secreto'];
    const senhaAtual = await obterSenha();

    if (senhaRecebida === senhaAtual) {
        const novaPromo = await Promocao.create(req.body);
        res.status(201).json(novaPromo);
    } else {
        res.status(401).send("Acesso negado");
    }
});

// Listar promoções
app.get('/promocoes', async (req, res) => {
    const promocoes = await Promocao.find();
    res.json(promocoes);
});

// Deletar promoção
app.delete('/promocoes/:id', async (req, res) => {
    const senhaRecebida = req.headers['codigo-secreto'];
    const senhaAtual = await obterSenha();

    if (senhaRecebida === senhaAtual) {
        await Promocao.findByIdAndDelete(req.params.id);
        res.status(200).send("Promoção apagada");
    } else {
        res.status(401).send("Acesso negado");
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log("Servidor rodando com Banco de Dados na Nuvem!");
});
