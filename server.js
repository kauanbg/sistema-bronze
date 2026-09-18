const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

app.use(express.static(__dirname));

const arquivoBanco = 'banco_de_dados.json';

function lerBanco() {
    if (!fs.existsSync(arquivoBanco)) {
        const dadosIniciais = {
            configuracoes: { senhaAdmin: "141607" },
            agendamentos: [],
            promocoes: []
        };
        fs.writeFileSync(arquivoBanco, JSON.stringify(dadosIniciais, null, 2));
    }
    const dadosBrutos = fs.readFileSync(arquivoBanco);
    return JSON.parse(dadosBrutos);
}

function salvarBanco(dados) {
    fs.writeFileSync(arquivoBanco, JSON.stringify(dados, null, 2));
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/salvar', (req, res) => {
    const banco = lerBanco();
    const { data, hora } = req.body;

    const totalNoHorario = banco.agendamentos.filter(a => a.data === data && a.hora === hora).length;

    if (totalNoHorario >= 2) {
        return res.status(400).json({ erro: "Este horário já atingiu o limite máximo de 2 pessoas!" });
    }

    banco.agendamentos.push(req.body);
    salvarBanco(banco);
    res.status(201).send("Agendamento salvo!");
});

app.get('/listar', (req, res) => {
    const senhaRecebida = req.headers['codigo-secreto'];
    const banco = lerBanco();
    
    if (senhaRecebida === banco.configuracoes.senhaAdmin) {
        res.json({ agendamentos: banco.agendamentos, configuracoes: banco.configuracoes });
    } else {
        res.status(401).send("Acesso negado");
    }
});

app.post('/promocoes', (req, res) => {
    const senhaRecebida = req.headers['codigo-secreto'];
    const banco = lerBanco();

    if (senhaRecebida === banco.configuracoes.senhaAdmin) {
        const novaPromo = { id: Date.now(), ...req.body };
        banco.promocoes.push(novaPromo);
        salvarBanco(banco);
        res.status(201).json(novaPromo);
    } else {
        res.status(401).send("Acesso negado");
    }
});

app.get('/promocoes', (req, res) => {
    const banco = lerBanco();
    res.json(banco.promocoes); 
});

app.delete('/promocoes/:id', (req, res) => {
    const senhaRecebida = req.headers['codigo-secreto'];
    const banco = lerBanco();

    if (senhaRecebida === banco.configuracoes.senhaAdmin) {
        banco.promocoes = banco.promocoes.filter(p => p.id != req.params.id);
        salvarBanco(banco);
        res.status(200).send("Promoção apagada");
    } else {
        res.status(401).send("Acesso negado");
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log("Servidor Online!");
});
