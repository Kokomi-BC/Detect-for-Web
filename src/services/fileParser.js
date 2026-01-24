const pdf = require('pdf-parse');
const mammoth = require('mammoth');
const xlsx = require('xlsx');
// Optional: If word-extractor is needed for .doc (binary), include it, but mammoth handles docx.
// Assuming .doc support is less critical or can be added later.

class FileParser {
    async parseFile(buffer, filename) {
        const ext = filename.split('.').pop().toLowerCase();
        
        try {
            if (ext === 'pdf') {
                const data = await pdf(buffer);
                // Return structure matching what frontend expects roughly
                // Frontend code: data?.text
                return { 
                    success: true,
                    type: 'pdf', 
                    data: { 
                        text: data.text, 
                        pages: data.numpages,
                        images: [] // PDF image extraction is hard with just pdf-parse
                    }
                };
            } else if (ext === 'docx') {
                const result = await mammoth.extractRawText({ buffer: buffer });
                // Mammoth messages can be warnings
                return { 
                    success: true,
                    type: 'docx', 
                    data: { 
                        text: result.value,
                        images: [] 
                    }
                };
            } else if (ext === 'txt' || ext === 'md' || ext === 'json') {
                return { 
                    success: true,
                    type: ext, 
                    data: { 
                        text: buffer.toString('utf8'),
                        images: [] 
                    }
                };
            } else if (ext === 'xlsx' || ext === 'xls') {
                const workbook = xlsx.read(buffer, { type: 'buffer' });
                // Merge all sheets? or just first?
                let allData = [];
                workbook.SheetNames.forEach(name => {
                    const sheet = workbook.Sheets[name];
                    const json = xlsx.utils.sheet_to_json(sheet);
                    json.forEach(row => {
                         // Convert row object to string representation
                         allData.push({ content: JSON.stringify(row), images: [] });
                    });
                });
                return { success: true, type: 'excel', data: allData };
            }
            
            throw new Error(`Unsupported file extension: .${ext}`);
        } catch (error) {
            console.error(`Error parsing file ${filename}:`, error);
            throw new Error(`Failed to parse file: ${error.message}`);
        }
    }
}

module.exports = FileParser;
