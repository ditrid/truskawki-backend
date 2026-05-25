// backend/server.js
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
require('dotenv').config();

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

// Konfiguracja puli połączeń do bazy MySQL
const pool = mysql.createPool({
    host: 'sql.serwer2505966.home.pl',
    user: '40111188_truskawki',        
    password: 'd2kxwvpk3j_1-',               
    database: '40111188_truskawki',    
    port: 3380,                        
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    ssl: { rejectUnauthorized: false },
    authPlugins: {
        sha256_password: mysql.authPlugins ? mysql.authPlugins.sha256_password : undefined,
        caching_sha2_password: mysql.authPlugins ? mysql.authPlugins.caching_sha2_password : undefined
    }
});

// Endpoint weryfikacji haseł
app.post('/api/weryfikuj-pin', async (req, res) => {
    const { stoisko, pin } = req.body;
    let rolaBazy = 'pin_szef';
    if (stoisko === 'Biedronka') rolaBazy = 'pin_biedronka';
    if (stoisko === 'Netto') rolaBazy = 'pin_netto';
    try {
        const [rows] = await pool.query("SELECT kod FROM hasla WHERE rola = ?", [rolaBazy]);
        if (rows && rows.length > 0) {
            if (pin === rows[0].kod.toString()) return res.json({ success: true });
        }
        return res.status(401).json({ success: false, error: "Nieprawidłowy kod PIN!" });
    } catch (err) {
        return res.status(500).json({ error: "Błąd bazy danych", details: err.toString() });
    }
});

// 1. Pobranie konfiguracji
app.get('/api/konfiguracja', async (req, res) => {
    try {
        const [cenyRows] = await pool.query("SELECT cena_za_kg FROM ceny_dzienne WHERE data = CURDATE()");
        let cenaTruskawek = cenyRows && cenyRows.length > 0 ? parseFloat(cenyRows[0].cena_za_kg) : 15.00;
        let warning = cenyRows && cenyRows.length > 0 ? "" : "Brak ceny owoców w DB na dziś! Awaryjna: 15.00 zł";

        const [ustawieniaRows] = await pool.query("SELECT wartosc FROM ustawienia WHERE klucz = 'cena_lubianki'");
        let cenaLubianki = ustawieniaRows && ustawieniaRows.length > 0 ? parseFloat(ustawieniaRows[0].wartosc) : 2.00;

        res.json({ cenaTruskawek, cenaLubianki, warning });
    } catch (err) {
        res.status(500).json({ error: "Błąd bazy danych", details: err.toString() });
    }
});

// 2. Dodanie nowej sprzedaży (Zaktualizowane o typ płatności: 'Gotówka' lub 'BLIK')
// ZASTĄP ENDPOINT W backend/server.js
app.post('/api/dodaj-sprzedaz', async (req, res) => {
    const { waga, kwota, stoisko, typPlatnosci, czyLubianka } = req.body; // <-- Dodano czyLubianka
    if (!stoisko) return res.status(400).json({ error: "Brak zdefiniowanego stoiska!" });
    
    const platnosc = typPlatnosci || 'Gotówka';
    const lubiankaFlaga = czyLubianka ? parseInt(czyLubianka) : 0;
    
    try {
        await pool.query(
            "INSERT INTO sprzedaz (waga_kg, kwota_pln, stoisko, typ_platnosci, czy_lubianka) VALUES (?, ?, ?, ?, ?)", 
            [waga, kwota, stoisko, platnosc, lubiankaFlaga]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// 3. Pobranie listy sprzedaży dla konkretnego stoiska
app.get('/api/sprzedaz-na-dzis', async (req, res) => {
    const stoisko = req.query.stoisko;
    try {
        const [rows] = await pool.query(
            "SELECT id, DATE_FORMAT(data_czas, '%H:%i:%s') as godzina, waga_kg, kwota_pln, typ_platnosci FROM sprzedaz WHERE DATE(data_czas) = CURDATE() AND stoisko = ? ORDER BY data_czas DESC",
            [stoisko]
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 4. Panel Szefa: Ustawianie ceny owoców
app.post('/api/ustaw-cene', async (req, res) => {
    const { data, cena } = req.body;
    try {
        await pool.query("INSERT INTO ceny_dzienne (data, cena_za_kg) VALUES (?, ?) ON DUPLICATE KEY UPDATE cena_za_kg = ?", [data, cena, cena]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 5. Zmiana stałej ceny łubianki
app.post('/api/ustaw-cene-lubianki', async (req, res) => {
    const { cena } = req.body;
    try {
        await pool.query("INSERT INTO ustawienia (klucz, wartosc) VALUES ('cena_lubianki', ?) ON DUPLICATE KEY UPDATE wartosc = ?", [cena, cena]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 6. Zapisywanie zakupu hurtowego ze wsparciem dla wybranej daty z frontendu
app.post('/api/dodaj-zakup-hurtowy', async (req, res) => {
    // 🆕 Odbieramy "dataHurt" przesłaną z formularza w React
    const { cenaHurt, iloscHurt, skrzynkiHurt, dataHurt } = req.body;
    
    // Zabezpieczenie: jeśli data z jakiegoś powodu nie dotrze, używamy dzisiejszej
    const ostatecznaData = dataHurt || new Date().toISOString().split('T')[0];

    try {
        await pool.query(
            `INSERT INTO zakupy_hurtowe (data, cena_hurt_za_kg, ilosc_hurt_kg, ilosc_hurt_skrzynek) 
             VALUES (?, ?, ?, ?) 
             ON DUPLICATE KEY UPDATE cena_hurt_za_kg = ?, ilosc_hurt_kg = ?, ilosc_hurt_skrzynek = ?`,
            [
              // Sekcja INSERT (zastąpiliśmy CURDATE() zmienną ostatecznaData)
              ostatecznaData, cenaHurt, iloscHurt, skrzynkiHurt, 
              // Sekcja UPDATE (w razie gdyby dla tej daty rekord już istniał)
              cenaHurt, iloscHurt, skrzynkiHurt
            ]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Błąd zapisu zakupu: " + err.message });
    }
});


// 7. Zapisywanie dostawy z garażu
// ZNAJDŹ I ZASTĄP ENDPOINT W backend/server.js

// backend/server.js - Endpoint zapisu dostawy z garażu
app.post('/api/dodaj-dostawu-stoiska', async (req, res) => {
    const { stoisko, kg, skrzynki, kierowca } = req.body;
    if (!kierowca) return res.status(400).json({ error: "Nie wybrano kierowcy!" });

    try {
        // Zwykłe dodanie wiersza – pozwoli na wielokrotne kursy tego samego dnia
        await pool.query(
            "INSERT INTO dostawy_stoisk (data, stoisko, dostarczono_kg, dostarczono_skrzynek, kierowca) VALUES (CURDATE(), ?, ?, ?, ?)",
            [stoisko, kg, skrzynki, kierowca]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Błąd zapisu dostawy: " + err.message });
    }
});



// 9. Panel Szefa: Dodawanie operacji kasowej (Wpłata na wydawanie / Zabrano nadmiar gotówki)
app.post('/api/dodaj-operacje-kasowa', async (req, res) => {
    const { stoisko, typ, kwota } = req.body; // typ: 'Wpłata na start' lub 'Wypłata z kasy'
    if (!stoisko || !typ || !kwota) return res.status(400).json({ error: "Brak kompletnych danych!" });
    try {
        await pool.query("INSERT INTO operacje_kasowe (stoisko, typ, kwota) VALUES (?, ?, ?)", [stoisko, typ, kwota]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Błąd zapisu kasy: " + err.message });
    }
});

// 10. Zapis końcowego rozliczenia stoiska do bazy danych
app.post('/api/zapisz-rozliczenie-stoiska', async (req, res) => {
    const { 
        stoisko, naWdawanie, zabrano, sprzedaneKg, zarobioneTotal, blik, doOddania, stratyKg,
        zostaloKg, 
        cenaTruskawki, utargGotowka, sprzedanoSkrzynekSzt, zostaloSkrzynekSzt, zarobekPracownika
    } = req.body;
    
    const s_kg = stratyKg ? parseFloat(stratyKg) : 0;
    const z_kg = zostaloKg ? parseFloat(zostaloKg) : 0;
    
    // 🔴 POPRAWKA: Precyzyjne sprawdzenie. Jeśli wartość to 0, "0" lub liczba, używamy jej. Jeśli pole jest całkiem puste, dajemy 220.
    let zarobek;
    if (zarobekPracownika !== undefined && zarobekPracownika !== null && zarobekPracownika !== '') {
        zarobek = parseFloat(zarobekPracownika);
    } else {
        zarobek = 250.00;
    }
    
    try {
        await pool.query(
            `INSERT INTO raporty_koncowe 
            (data, stoisko, pieniadze_na_wydawanie, zabrano_z_kasy, sprzedano_kg, zarobiono_total, blik_online, powinien_oddac_gotowka, straty_kg, zostalo_kg, cena_truskawki, utarg_gotowka, sprzedano_skrzynek_szt, zostalo_skrzynek_szt, zarobek_pracownika) 
            VALUES (CURDATE(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) 
            ON DUPLICATE KEY UPDATE 
            pieniadze_na_wydawanie = VALUES(pieniadze_na_wydawanie), 
            zabrano_z_kasy = VALUES(zabrano_z_kasy), 
            sprzedano_kg = VALUES(sprzedano_kg), 
            zarobiono_total = VALUES(zarobiono_total), 
            blik_online = VALUES(blik_online), 
            powinien_oddac_gotowka = VALUES(powinien_oddac_gotowka), 
            straty_kg = VALUES(straty_kg), 
            zostalo_kg = VALUES(zostalo_kg), 
            cena_truskawki = VALUES(cena_truskawki), 
            utarg_gotowka = VALUES(utarg_gotowka), 
            sprzedano_skrzynek_szt = VALUES(sprzedano_skrzynek_szt), 
            zostalo_skrzynek_szt = VALUES(zostalo_skrzynek_szt), 
            zarobek_pracownika = VALUES(zarobek_pracownika)`,
            [
              stoisko, naWdawanie, zabrano, sprzedaneKg, zarobioneTotal, blik, doOddania, s_kg, z_kg, cenaTruskawki, utargGotowka, sprzedanoSkrzynekSzt, zostaloSkrzynekSzt, zarobek
            ]
        );
        res.json({ success: true });
    } catch (err) {
        console.error("Błąd zapisu MySQL:", err);
        res.status(500).json({ error: "Błąd zapisu rozliczenia: " + err.message });
    }
});








// 8. ZAKTUALIZOWANY ENDPOINT: Pobranie stanu magazynu, szczegółowych danych kasowych i rozliczeń dla WYBRANEJ DATY lub DZIŚ
app.get('/api/stan-magazynu-szefa', async (req, res) => {
    // 🆕 Pobieramy datę z query stringa (np. ?data=2026-05-24). Jeśli jej nie ma, używamy dzisiejszej daty z serwera
    const wybranaData = req.query.data || new Date().toISOString().split('T')[0];

    try {
        // 🆕 Zamieniliśmy CURDATE() na zmienną [wybranaData] we wszystkich zapytaniach SQL
        const [hurt] = await pool.query("SELECT cena_hurt_za_kg, ilosc_hurt_kg, ilosc_hurt_skrzynek FROM zakupy_hurtowe WHERE data = ?", [wybranaData]);
        const hurtKg = hurt && hurt.length > 0 ? parseFloat(hurt[0].ilosc_hurt_kg) : 0;
        const hurtSkrzynki = hurt && hurt.length > 0 ? parseInt(hurt[0].ilosc_hurt_skrzynek) : 0;
        const cenaHurt = hurt && hurt.length > 0 ? parseFloat(hurt[0].cena_hurt_za_kg) : 0;

        const [dostawy] = await pool.query("SELECT stoisko, dostarczono_kg, dostarczono_skrzynek, kierowca FROM dostawy_stoisk WHERE DATE(data) = ?", [wybranaData]);
        
        // Zoptymalizowane zapytanie sumujące osono Gotówkę i BLIK dla każdego stoiska
        const [sprzedaz] = await pool.query(`
            SELECT stoisko, 
                   SUM(waga_kg) as sprzedane_kg, 
                   SUM(kwota_pln) as utarg_pln,
                   SUM(CASE WHEN typ_platnosci = 'BLIK' THEN kwota_pln ELSE 0 END) as blik_pln,
                   SUM(CASE WHEN typ_platnosci = 'Gotówka' THEN kwota_pln ELSE 0 END) as gotowka_pln,
                   
                   -- ✅ POPRAWKA: Zliczamy sztuki TYLKO tam, gdzie pracownik zaznaczył skrzynkę (czy_lubianka = 1)
                   SUM(CASE WHEN czy_lubianka = 1 THEN 1 ELSE 0 END) as sprzedane_skrzynek_baza
                   
            FROM sprzedaz 
            WHERE DATE(data_czas) = ? 
            GROUP BY stoisko
        `, [wybranaData]);
        
        const [kasa] = await pool.query("SELECT stoisko, typ, kwota, DATE_FORMAT(data_czas, '%H:%i:%s') as godzina FROM operacje_kasowe WHERE DATE(data_czas) = ? ORDER BY data_czas DESC", [wybranaData]);
        
        // Pobranie zapisanych już raportów rozliczeniowych z wybranego dnia
        const [raporty] = await pool.query("SELECT * FROM raporty_koncowe WHERE data = ?", [wybranaData]);

        // Pobranie zapisanego globalnego komentarza szefa z tego dnia
        const [globalne] = await pool.query("SELECT komentarz FROM podsumowania_dzienne WHERE data = ?", [wybranaData]);
        const komentarzTekst = globalne && globalne.length > 0 ? globalne[0].komentarz : "";

        res.json({
            hurtKg,
            hurtSkrzynki,
            cenaHurt,
            dostawy,
            sprzedaz,
            kasa,
            raporty,
            // 🆕 Przekazujemy strukturę raportyGlobalne, aby frontendowy warunek IF poprawnie odczytał komentarz
            raportyGlobalne: {
                komentarz: komentarzTekst
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});











// 1. Pobieranie dzisiejszych wydatków
// 1. ZAKTUALIZOWANE: Pobieranie wydatków dla WYBRANEJ DATY z kalendarza (lub dziś)
app.get('/api/wydatki-dzis', async (req, res) => {
    // Odbieramy datę z query stringa (?data=...). Jeśli jej nie ma, bierzemy dzisiejszą z serwera
    const dataFiltr = req.query.data || new Date().toISOString().split('T')[0];
    try {
        // Zastąpiono CURDATE() parametrem przekazanym z kalendarza
        const [rows] = await pool.query("SELECT * FROM wydatki WHERE data = ? ORDER BY id DESC", [dataFiltr]);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});


// 2. Dodawanie lub edycja wydatku
app.post('/api/zapisz-wydatek', async (req, res) => {
    // 🆕 Odbieramy parametr dataZalegla z frontendu
    const { id, nazwa, kwota, dataZalegla } = req.body;
    const ostatecznaData = dataZalegla || new Date().toISOString().split('T')[0];
    try {
        if (id) {
            await pool.query("UPDATE wydatki SET nazwa = ?, kwota_pln = ? WHERE id = ?", [nazwa, kwota, id]);
        } else {
            // 🆕 Zamieniono CURDATE() na znak zapytania ? i dodano ostatecznaData
            await pool.query("INSERT INTO wydatki (data, nazwa, kwota_pln) VALUES (?, ?, ?)", [ostatecznaData, nazwa, kwota]);
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 3. Usuwanie wydatku
app.delete('/api/usun-wydatek/:id', async (req, res) => {
    try {
        await pool.query("DELETE FROM wydatki WHERE id = ?", [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});



// 1. Pobieranie dzisiejszych innych wpływów
// 2. ZAKTUALIZOWANE: Pobieranie innych wpływów dla WYBRANEJ DATY z kalendarza (lub dziś)
app.get('/api/inne-wplywy-dzis', async (req, res) => {
    // Odbieramy datę z query stringa (?data=...). Jeśli jej nie ma, bierzemy dzisiejszą z serwera
    const dataFiltr = req.query.data || new Date().toISOString().split('T')[0];
    try {
        // Zastąpiono CURDATE() parametrem przekazanym z kalendarza
        const [rows] = await pool.query("SELECT * FROM inne_wplywy WHERE data = ? ORDER BY id DESC", [dataFiltr]);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2. Zapisywanie lub edycja innego wpływu
app.post('/api/zapisz-wplyw', async (req, res) => {
    // 🆕 Odbieramy parametr dataZalegla z frontendu
    const { id, nazwa, dlaKogo, kwota, dataZalegla } = req.body;
    const ostatecznaData = dataZalegla || new Date().toISOString().split('T')[0];
    try {
        if (id) {
            await pool.query("UPDATE inne_wplywy SET nazwa = ?, dla_kogo = ?, kwota_pln = ? WHERE id = ?", [nazwa, dlaKogo, kwota, id]);
        } else {
            // 🆕 Zamieniono CURDATE() na znak zapytania ? i dodano ostatecznaData
            await pool.query("INSERT INTO inne_wplywy (data, nazwa, dla_kogo, kwota_pln) VALUES (?, ?, ?, ?)", [ostatecznaData, nazwa, dlaKogo, kwota]);
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 3. Usuwanie innego wpływu
app.delete('/api/usun-wplyw/:id', async (req, res) => {
    try {
        await pool.query("DELETE FROM inne_wplywy WHERE id = ?", [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});



// 4. Uaktualniony endpoint zapisu globalnego podsumowania dnia z nowymi kolumnami i komentarzem
app.post('/api/zapisz-globalne-podsumowanie', async (req, res) => {
    // 🆕 Odbieramy "wybranaDataString" przesłaną z kalendarza we frontendzie
    const { wybranaDataString, utargTotal, kosztZakupuHurt, wyplatyPracownikow, wydatkiTotal, inneWplywyTotal, zyskNetto, naOsobe, komentarz } = req.body;
    
    // Zabezpieczenie: jeśli z jakiegoś powodu data nie dotrze, serwer użyje dzisiejszej
    const ostatecznaData = wybranaDataString || new Date().toISOString().split('T')[0];

    try {
        await pool.query(
            `INSERT INTO podsumowania_dzienne 
            (data, utarg_total_pln, koszt_zakupu_hurt_pln, wyplaty_pracownikow_pln, wydatki_total_pln, inne_wplywy_total_pln, zysk_netto_pln, na_osobe_pln, komentarz) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) 
            ON DUPLICATE KEY UPDATE 
            utarg_total_pln=?, koszt_zakupu_hurt_pln=?, wyplaty_pracownikow_pln=?, wydatki_total_pln=?, inne_wplywy_total_pln=?, zysk_netto_pln=?, na_osobe_pln=?, komentarz=?`,
            [
              // 🆕 Sekcja INSERT: zamieniliśmy CURDATE() na ostatecznaData
              ostatecznaData, utargTotal, kosztZakupuHurt, wyplatyPracownikow, wydatkiTotal, inneWplywyTotal, zyskNetto, naOsobe, komentarz,
              // Sekcja UPDATE:
              utargTotal, kosztZakupuHurt, wyplatyPracownikow, wydatkiTotal, inneWplywyTotal, zyskNetto, naOsobe, komentarz
            ]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "Błąd zapisu globalnego: " + err.message }); }
});










// DOTYCZY PODSUMOWANIA DNI 

// 12. Pobranie historii wszystkich zapisanych dni (do listy)
app.get('/api/historia-podsumowan', async (req, res) => {
    try {
        const [rows] = await pool.query(
            "SELECT DATE_FORMAT(data, '%Y-%m-%d') as data_format, zysk_netto_pln, utarg_total_pln FROM podsumowania_dzienne ORDER BY data DESC"
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 13. Pobranie absolutnie wszystkich danych z konkretnego dnia wstecz
app.get('/api/szczegoly-dnia/:data', async (req, res) => {
    const wybranaData = req.params.data; // format YYYY-MM-DD
    try {
        // Główny raport finansowy dnia
        const [globalne] = await pool.query(
            "SELECT *, DATE_FORMAT(data, '%Y-%m-%d') as data_format FROM podsumowania_dzienne WHERE data = ?", [wybranaData]
        );
        // Sprzedaż na stoiskach z tego dnia
        const [sprzedaz] = await pool.query(`
            SELECT stoisko, SUM(waga_kg) as sprzedane_kg, SUM(kwota_pln) as utarg_pln,
                   SUM(CASE WHEN typ_platnosci = 'BLIK' THEN kwota_pln ELSE 0 END) as blik_pln,
                   SUM(CASE WHEN typ_platnosci = 'Gotówka' THEN kwota_pln ELSE 0 END) as gotowka_pln
            FROM sprzedaz WHERE DATE(data_czas) = ? GROUP BY stoisko`, [wybranaData]);
        // Dostawy z tego dnia
        const [dostawy] = await pool.query("SELECT * FROM dostawy_stoisk WHERE DATE(data) = ?", [wybranaData]);
        // Wydatki z tego dnia
        const [wydatki] = await pool.query("SELECT * FROM wydatki WHERE data = ?", [wybranaData]);
        // Inne wpływy z tego dnia
        const [wplywy] = await pool.query("SELECT * FROM inne_wplywy WHERE data = ?", [wybranaData]);

        res.json({
            podsumowanie: globalne && globalne.length > 0 ? globalne[0] : null,
            sprzedaz,
            dostawy,
            wydatki,
            wplywy
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});












app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Serwer działa poprawnie!`);
});

