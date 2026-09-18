const express = require('express');
const cors = require('cors');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname)); // Faz o site aparecer na internet

const arquivoBanco = 'banco_de_dados.json';

function lerBanco() {
    if (!fs.existsSync(arquivoBanco)) {
        fs.writeFileSync(arquivoBanco, JSON.stringify({ agendamentos: [], promocoes: [] }));
    }
    const dadosBrutos = fs.readFileSync(arquivoBanco);
    return JSON.parse(dadosBrutos);
}

function salvarBanco(dados) {
    fs.writeFileSync(arquivoBanco, JSON.stringify(dados, null, 2));
}

app.post('/salvar', (req, res) => {
    const banco = lerBanco();
    banco.agendamentos.push(req.body);
    salvarBanco(banco);
    res.status(201).send("Agendamento salvo!");
});

app.get('/listar', (req, res) => {
    const senha = req.headers['codigo-secreto'];
    if (senha === 'pauluzzi2026') {
        const banco = lerBanco();
        res.json(banco.agendamentos);
    } else {
        res.status(401).send("Acesso negado");
    }
});

app.post('/promocoes', (req, res) => {
    const senha = req.headers['codigo-secreto'];
    if (senha === 'pauluzzi2026') {
        const banco = lerBanco();
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
    const senha = req.headers['codigo-secreto'];
    if (senha === 'pauluzzi2026') {
        const banco = lerBanco();
        banco.promocoes = banco.promocoes.filter(p => p.id != req.params.id);
        salvarBanco(banco);
        res.status(200).send("Promoção apagada");
    } else {
        res.status(401).send("Acesso negado");
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log("Servidor Online 24h na Internet!");
});
